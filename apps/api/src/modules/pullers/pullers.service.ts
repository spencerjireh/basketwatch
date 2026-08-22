import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type PullerRunResponse } from "@basketwatch/contract";
import { type Env } from "../../config/env.schema.js";
import { BossService } from "../../jobs/boss.provider.js";
import { QUEUES } from "../../jobs/queues.js";
import { StudioError } from "./adapters/studio.adapter.js";
import { dedupe, diff, isMassChange } from "./diff.js";
import { PullerRegistry } from "./puller.registry.js";
import { type PullResult, type PullerConfig, type PullerRunOptions } from "./puller.types.js";
import { PullersRepository, type RunSummary } from "./pullers.repository.js";

export type PullProgress = {
  storeId: string;
  status: "collecting" | "processing" | "done" | "error";
  transport: "studio" | null;
  startedAt: number;
  elapsedMs: number;
  result: PullerRunResponse | null;
  error: string | null;
};

@Injectable()
export class PullersService {
  private readonly logger = new Logger(PullersService.name);
  private readonly activePulls = new Map<string, PullProgress>();

  constructor(
    private readonly registry: PullerRegistry,
    private readonly repository: PullersRepository,
    private readonly boss: BossService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  getPullProgress(storeId: string): PullProgress | null {
    const p = this.activePulls.get(storeId);
    if (!p) return null;
    return { ...p, elapsedMs: Date.now() - p.startedAt };
  }

  /** Fire-and-forget: starts the pull in the background and returns immediately. */
  startPullAsync(storeId: string): { status: string; storeId: string } {
    if (this.activePulls.has(storeId)) {
      return { status: "already_running", storeId };
    }
    this.activePulls.set(storeId, {
      storeId,
      status: "collecting",
      transport: null,
      startedAt: Date.now(),
      elapsedMs: 0,
      result: null,
      error: null,
    });
    this.runStore(storeId, { dryRun: false, trigger: "manual" }).then(
      (result) => {
        const p = this.activePulls.get(storeId);
        if (p) {
          p.status = "done";
          p.elapsedMs = Date.now() - p.startedAt;
          p.result = result;
        }
      },
      (err: unknown) => {
        const p = this.activePulls.get(storeId);
        if (p) {
          p.status = "error";
          p.elapsedMs = Date.now() - p.startedAt;
          p.error = err instanceof Error ? err.message : String(err);
        }
        this.logger.error(`${storeId}: async pull failed -- ${err instanceof Error ? err.message : String(err)}`);
      },
    );
    return { status: "started", storeId };
  }

  clearPullProgress(storeId: string): void {
    this.activePulls.delete(storeId);
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

    const p = this.activePulls.get(storeId);
    if (p) {
      p.transport = "studio";
      p.status = "processing";
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

    if (suppressed) {
      await this.repository.openIncident(config.storeId, runId, "mass_change_suppressed", {
        rows: rows.length,
        changes: changes.length,
        reason: "over 90% of an established catalogue changed at once",
      });
    }

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
    this.logger.warn(`${config.storeId}: studio failed -- ${err.message}`);

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

    const evidence: Record<string, unknown> = {
      kind: "studio_error",
      error: err.message,
      rawSample: err.rawOutput.slice(0, 5),
      rawFieldNames: this.extractFieldNames(err.rawOutput),
    };

    const incidentId = await this.repository.openIncident(
      config.storeId, runId, "studio_error", evidence, config.collectorId,
    );

    this.logger.log(
      `${config.storeId}: run ${runId} recorded as failed, incident ${incidentId} opened`,
    );

    if (config.collectorId && !this.config.get("HEAL_AUTO_ENABLED", { infer: true })) {
      // The incident stands; only the Bright Data call is skipped. Nothing is
      // queued, so arming the flag later does not release a backlog of heals.
      this.logger.log(
        `${config.storeId}: auto-heal is disabled (HEAL_AUTO_ENABLED=false); ` +
          `incident ${incidentId} stands unhealed`,
      );
    } else if (config.collectorId) {
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
        findings: [{
          check: "schema",
          severity: "hard",
          detail: `Studio error: ${err.message}`,
        }],
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
      throw new NotFoundException(
        `${config.storeId} has no Studio collector. Provision one first via POST /api/fleet/${config.storeId}/provision.`,
      );
    }
    const studio = this.registry.get("studio");
    if (!studio) throw new StudioError("no studio adapter registered");
    return studio.pull(config);
  }
}
