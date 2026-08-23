import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type PullerRunResponse } from "@basketwatch/contract";
import { type Env } from "../../config/env.schema.js";
import { BossService } from "../../jobs/boss.provider.js";
import { QUEUES } from "../../jobs/queues.js";
import { StudioError } from "./adapters/studio.adapter.js";
import { STUDIO_FAILURE } from "./studio-failure.js";
import { dedupe, diff, isMassChange } from "./diff.js";
import { PullerRegistry } from "./puller.registry.js";
import { type PullResult, type PullerConfig, type PullerRunOptions } from "./puller.types.js";
import { PullersRepository, type RunSummary } from "./pullers.repository.js";

/**
 * Runs a store's catalogue pull. One implementation, whether the ask came from
 * the schedule or from the ops API -- both arrive as a scrape-run job, so
 * there is no second code path to keep in step and no way for the two to race.
 */
@Injectable()
export class PullersService {
  private readonly logger = new Logger(PullersService.name);

  constructor(
    private readonly registry: PullerRegistry,
    private readonly repository: PullersRepository,
    private readonly boss: BossService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Whether this store already has a pull waiting or running on the queue. */
  hasPendingPull(storeId: string): Promise<boolean> {
    return this.repository.hasPendingPull(storeId);
  }

  /** Every store with a catalogue to pull, for the fleet fan-out. */
  async pullableStoreIds(): Promise<string[]> {
    const stores = await this.repository.pullableStores();
    return stores.map((store) => store.storeId);
  }

  async runStore(storeId: string, options: PullerRunOptions): Promise<PullerRunResponse> {
    const startedAt = Date.now();
    const [config] = await this.repository.pullableStores([storeId]);
    if (!config) throw new NotFoundException(`No pullable store with id ${storeId}.`);

    let result: PullResult;
    try {
      result = await this.collect(config);
    } catch (err) {
      if (err instanceof StudioError) {
        return this.handleStudioFailure(config, err, options, startedAt);
      }
      throw err;
    }

    const rows = dedupe(result.rows);
    const previous = await this.repository.latestPrices(config.storeId);
    const changes = diff(previous, rows);

    const established = previous.size > 0;
    const suppressed = isMassChange(rows.length, changes.length, established);
    const ceilingReached = config.maxPages > 0 && result.pages >= config.maxPages;
    const source = rows[0]?.source ?? "puller";

    const summary: RunSummary = {
      storeId: config.storeId,
      method: config.method,
      transport: "studio",
      source,
      trigger: options.trigger,
      rows: rows.length,
      unitPriced: rows.filter((row) => row.unitPrice !== null).length,
      pages: result.pages,
      ceilingReached,
      changes: suppressed ? 0 : changes.length,
      coverage: null,
      rawOutput: result.rawOutput,
    };

    if (options.dryRun) {
      this.logger.log(
        `${config.storeId}: dry run, ${rows.length} rows, ${changes.length} would change`,
      );
      return {
        storeId: config.storeId,
        dryRun: true,
        runId: null,
        rows: rows.length,
        pages: result.pages,
        ceilingReached,
        changes: changes.length,
        verdict: null,
        durationMs: Date.now() - startedAt,
      };
    }

    // A near-total change rate on an established store is far more likely to be
    // a product-key scheme change than a real repricing of everything. The run
    // is kept as evidence and the price history is left alone.
    const runId = suppressed
      ? await this.repository.recordEmptyRun({ ...summary, rows: rows.length })
      : await this.repository.recordRun(summary, rows, changes);

    // Same dedupe rule as the failure path: the run is always recorded, a
    // second open incident for the same store is not.
    if (suppressed && !(await this.repository.hasOpenIncident(config.storeId))) {
      await this.repository.openIncident(config.storeId, runId, "mass_change_suppressed", {
        rows: rows.length,
        changes: changes.length,
        reason: "over 90% of an established catalogue changed at once",
      });
    }

    await this.enqueueValidation(runId, config.storeId);

    this.logger.log(
      `${config.storeId}: run ${runId}, ${rows.length} rows, ${summary.changes} changes` +
        (ceilingReached ? " (ceiling reached)" : "") +
        (suppressed ? " MASS-CHANGE SUPPRESSED" : ""),
    );

    return {
      storeId: config.storeId,
      dryRun: false,
      runId: String(runId),
      rows: rows.length,
      pages: result.pages,
      ceilingReached,
      changes: summary.changes,
      // The puller's own verdict on the run, not the spider-sense validator's:
      // the only judgement it can make without a baseline is whether it
      // applied what it collected.
      verdict: suppressed
        ? {
            status: "suspect",
            findings: [
              {
                check: "drift",
                severity: "hard",
                detail: `${changes.length} of ${rows.length} prices changed at once; observations suppressed`,
              },
            ],
          }
        : { status: "ok", findings: [] },
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Studio threw: record the failure as a run, open an incident with the raw
   * output as evidence, and enqueue a heal. Returns a response the caller can
   * hand back without rethrowing.
   */
  private async handleStudioFailure(
    config: PullerConfig,
    err: StudioError,
    options: PullerRunOptions,
    startedAt: number,
  ): Promise<PullerRunResponse> {
    const policy = STUDIO_FAILURE[err.kind];
    this.logger.warn(`${config.storeId}: studio failed (${err.kind}) -- ${err.message}`);

    // A dry run promises to write nothing, and the happy path already keeps
    // that promise. The failure path did not: it recorded a run, opened an
    // incident and queued a heal, so the safe way to test a broken store was
    // the one that spent money.
    if (options.dryRun) {
      return {
        storeId: config.storeId,
        dryRun: true,
        runId: null,
        rows: 0,
        pages: 0,
        ceilingReached: false,
        changes: 0,
        verdict: {
          status: "broken",
          findings: [{ check: policy.check, severity: "hard", detail: err.message }],
        },
        durationMs: Date.now() - startedAt,
      };
    }

    const summary: RunSummary = {
      storeId: config.storeId,
      method: config.method,
      transport: "studio",
      source: "studio",
      trigger: options.trigger,
      rows: 0,
      unitPriced: 0,
      pages: 0,
      ceilingReached: false,
      changes: 0,
      coverage: null,
      rawOutput: err.rawOutput.length > 0 ? err.rawOutput : undefined,
    };

    const runId = await this.repository.recordEmptyRun(summary);

    // The first eight keys are what incidentEvidenceSchema requires. Writing a
    // different shape meant safeParse failed and the salvage path replaced the
    // whole thing with zeroes -- so every Studio incident rendered as "0 of ~0
    // rows" with no failed check and no sample.
    //
    // The rest are stripped by the parse but stay in the jsonb, which is where
    // `summarise` looks for `reason` and where the heal orchestrator reads
    // `error` and `rawSample` to compose its prompt.
    const evidence: Record<string, unknown> = {
      kind: policy.incidentKind,
      failedChecks: [{ check: policy.check, severity: "hard", detail: err.message }],
      sampleBadRows: err.rawOutput.slice(0, 5),
      sampleGoodRows: [],
      fieldNullRates: {},
      baselineNullRates: {},
      rowCount: 0,
      expectedRowCount: 0,
      reason: policy.reason(err.message),
      error: err.message,
      rawSample: err.rawOutput.slice(0, 5),
      rawFieldNames: this.extractFieldNames(err.rawOutput),
      studioDetail: err.detail,
    };

    // The run row is the invariant and is always written; a second incident for
    // a store that already has one open is just noise, and the validator has
    // always worked this way.
    if (await this.repository.hasOpenIncident(config.storeId)) {
      this.logger.log(
        `${config.storeId}: run ${runId} recorded as failed, incident already open`,
      );
      return this.studioFailureResponse(config, err, policy, startedAt, runId);
    }

    const incidentId = await this.repository.openIncident(
      config.storeId, runId, policy.incidentKind, evidence, config.collectorId,
    );

    this.logger.log(
      `${config.storeId}: run ${runId} recorded as failed, incident ${incidentId} opened`,
    );

    // Two separate questions, both of which must say yes before a credit is
    // spent. First: is this kind of failure one a template rewrite could fix?
    if (!policy.autoHeal) {
      this.logger.log(
        `${config.storeId}: ${err.kind} is not repairable by a template rewrite; no heal queued`,
      );
      return this.studioFailureResponse(config, err, policy, startedAt, runId);
    }

    // Second: is the loop switched on at all? Checked here rather than only in
    // the worker so a disarmed loop leaves nothing queued to fire later.
    if (!this.config.get("HEAL_AUTO_ENABLED", { infer: true })) {
      this.logger.log(
        `${config.storeId}: auto-heal is disabled (HEAL_AUTO_ENABLED=false); ` +
          `incident ${incidentId} stands unhealed`,
      );
      return this.studioFailureResponse(config, err, policy, startedAt, runId);
    }

    if (config.collectorId) {
      try {
        await this.boss.send(QUEUES.heal, {
          scraperId: config.collectorId,
          storeId: config.storeId,
          incidentId,
        }, { singletonKey: config.collectorId, retryLimit: 0 });
        this.logger.log(`${config.storeId}: heal job enqueued`);
      } catch (healErr) {
        this.logger.error(
          `${config.storeId}: failed to enqueue heal -- ` +
            `${healErr instanceof Error ? healErr.message : String(healErr)}`,
        );
      }
    }

    return this.studioFailureResponse(config, err, policy, startedAt, runId);
  }

  /**
   * Validation belongs to the run, not to whoever was watching it.
   *
   * This used to be enqueued by the dashboard's status endpoint, on the poll
   * that first saw the pull finish -- so closing the tab at the wrong moment
   * meant the run was never validated and its anomalies never found.
   */
  private async enqueueValidation(runId: number, storeId: string): Promise<void> {
    try {
      await this.boss.send(QUEUES.validateRun, { runId: Number(runId), storeId });
    } catch (err) {
      this.logger.error(
        `${storeId}: failed to enqueue validation for run ${runId} -- ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The same failed-run answer whether or not a heal was queued behind it. */
  private studioFailureResponse(
    config: PullerConfig,
    err: StudioError,
    policy: (typeof STUDIO_FAILURE)[StudioError["kind"]],
    startedAt: number,
    runId: number,
  ): PullerRunResponse {
    return {
      storeId: config.storeId,
      dryRun: false,
      runId: String(runId),
      rows: 0,
      pages: 0,
      ceilingReached: false,
      changes: 0,
      verdict: {
        status: "broken",
        findings: [{ check: policy.check, severity: "hard", detail: err.message }],
      },
      durationMs: Date.now() - startedAt,
    };
  }

  /** Extract the set of field names Studio returned, for diagnostic prompts. */
  private extractFieldNames(raw: unknown[]): string[] {
    const names = new Set<string>();
    for (const item of raw.slice(0, 5)) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          names.add(key);
        }
      }
    }
    return [...names].sort();
  }

  /**
   * All production pulls go through Bright Data Studio. If a store has no
   * collector yet, the pull fails with a clear error requiring provisioning.
   * There is no HTTP fallback -- a Studio failure surfaces as a real failure,
   * gets diagnosed by the validator, and triggers a heal.
   */
  private async collect(config: PullerConfig): Promise<PullResult> {
    if (!config.collectorId) {
      // A StudioError, not a NotFoundException: this escapes runStore's catch
      // otherwise, and once pulls run on the queue that means a job that
      // retries an unprovisionable store instead of recording why it failed.
      throw new StudioError(
        `${config.storeId} has no Studio collector. Provision one first via POST /api/fleet/${config.storeId}/provision.`,
        "unprovisioned",
      );
    }
    const studio = this.registry.get("studio");
    // A server misconfiguration, not a store fault -- it should 500 rather
    // than open an incident against a store that did nothing wrong.
    if (!studio) throw new Error("no studio adapter registered");
    return studio.pull(config);
  }
}
