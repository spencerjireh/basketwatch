import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { type PullerRunResponse } from "@basketwatch/contract";
import { BossService } from "../../jobs/boss.provider.js";
import { QUEUES } from "../../jobs/queues.js";
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

  /**
   * The central pull method. Collects a store's catalogue through the adapter
   * the store row's `method` names, dedupes the rows, diffs against the previous snapshot,
   * guards against mass-change events (>90% of an established catalogue
   * changing at once), persists the run, and enqueues validation.
   *
   * A pull that throws, or that returns nothing for a store with history, is
   * routed to `handlePullFailure`, which records the broken run and opens an
   * incident. The caller always gets a response, never an unhandled throw.
   */
  async runStore(storeId: string, options: PullerRunOptions): Promise<PullerRunResponse> {
    const startedAt = Date.now();
    const [config] = await this.repository.pullableStores([storeId]);
    if (!config) throw new NotFoundException(`No pullable store with id ${storeId}.`);

    const previous = await this.repository.latestPrices(config.storeId);
    const established = previous.size > 0;

    // The adapter is chosen by the store row's `method`; nothing else decides.
    // A missing adapter is a server misconfiguration, not a store fault, so it
    // 500s here rather than opening an incident against an innocent store.
    const puller = this.registry.get(config.method);
    if (!puller) throw new Error(`no adapter registered for method "${config.method}"`);

    let result: PullResult;
    try {
      result = await puller.pull(config);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return this.handlePullFailure(config, detail, options, startedAt);
    }

    // A store that has priced products before and now yields none did not
    // empty its shelves; the adapter stopped understanding the site.
    if (result.rows.length === 0 && established) {
      return this.handlePullFailure(
        config,
        `pull returned no rows for a store with ${previous.size} priced products`,
        options,
        startedAt,
      );
    }

    const rows = dedupe(result.rows);
    const changes = diff(previous, rows);

    const suppressed = isMassChange(rows.length, changes.length, established);
    const ceilingReached = config.maxPages > 0 && result.pages >= config.maxPages;

    const summary: RunSummary = {
      storeId: config.storeId,
      method: config.method,
      trigger: options.trigger,
      rows: rows.length,
      unitPriced: rows.filter((row) => row.unitPrice !== null).length,
      pages: result.pages,
      ceilingReached,
      changes: suppressed ? 0 : changes.length,
      coverage: null,
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

    // A suppressed run applied nothing, so there is nothing new to validate --
    // and validating the old products would read as recovery.
    if (!suppressed) await this.enqueueValidation(runId, config.storeId);

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
   * The pull itself failed: the fetch threw, the payload did not parse, or an
   * established store came back empty. The run is always recorded as evidence;
   * an incident opens unless one is already open for the store. Nothing is
   * enqueued for validation -- there are no new rows to judge, and judging the
   * old ones would read as recovery.
   */
  private async handlePullFailure(
    config: PullerConfig,
    detail: string,
    options: PullerRunOptions,
    startedAt: number,
  ): Promise<PullerRunResponse> {
    this.logger.warn(`${config.storeId}: pull failed -- ${detail}`);

    const verdict = {
      status: "broken" as const,
      findings: [{ check: "error" as const, severity: "hard" as const, detail }],
    };

    // A dry run promises to write nothing, on the failure path too.
    if (options.dryRun) {
      return {
        storeId: config.storeId,
        dryRun: true,
        runId: null,
        rows: 0,
        pages: 0,
        ceilingReached: false,
        changes: 0,
        verdict,
        durationMs: Date.now() - startedAt,
      };
    }

    const runId = await this.repository.recordEmptyRun({
      storeId: config.storeId,
      method: config.method,
      trigger: options.trigger,
      rows: 0,
      unitPriced: 0,
      pages: 0,
      ceilingReached: false,
      changes: 0,
      coverage: null,
    });

    if (await this.repository.hasOpenIncident(config.storeId)) {
      this.logger.log(`${config.storeId}: run ${runId} recorded as failed, incident already open`);
    } else {
      // The first eight keys are what incidentEvidenceSchema requires; `reason`
      // is stripped by the parse but stays in the jsonb for `summarise`.
      const incidentId = await this.repository.openIncident(config.storeId, runId, "pull_failed", {
        kind: "pull_failed",
        failedChecks: verdict.findings,
        sampleBadRows: [],
        sampleGoodRows: [],
        fieldNullRates: {},
        baselineNullRates: {},
        rowCount: 0,
        expectedRowCount: 0,
        reason: detail,
      });
      this.logger.log(
        `${config.storeId}: run ${runId} recorded as failed, incident ${incidentId} opened`,
      );
    }

    return {
      storeId: config.storeId,
      dryRun: false,
      runId: String(runId),
      rows: 0,
      pages: 0,
      ceilingReached: false,
      changes: 0,
      verdict,
      durationMs: Date.now() - startedAt,
    };
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
}
