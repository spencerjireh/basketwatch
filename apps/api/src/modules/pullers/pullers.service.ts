import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { type PullerRunResponse } from "@basketwatch/contract";
import { StudioError } from "./adapters/studio.adapter.js";
import { dedupe, diff, isMassChange } from "./diff.js";
import { PullerRegistry } from "./puller.registry.js";
import { type PullResult, type PullerConfig, type PullerRunOptions } from "./puller.types.js";
import { PullersRepository, type RunSummary } from "./pullers.repository.js";

@Injectable()
export class PullersService {
  private readonly logger = new Logger(PullersService.name);

  constructor(
    private readonly registry: PullerRegistry,
    private readonly repository: PullersRepository,
  ) {}

  /** Every store with a catalogue to pull, for the fleet fan-out. */
  async pullableStoreIds(): Promise<string[]> {
    const stores = await this.repository.pullableStores();
    return stores.map((store) => store.storeId);
  }

  async runStore(storeId: string, options: PullerRunOptions): Promise<PullerRunResponse> {
    const startedAt = Date.now();
    const [config] = await this.repository.pullableStores([storeId]);
    if (!config) throw new NotFoundException(`No pullable store with id ${storeId}.`);

    const { result, transport, fallbackReason } = await this.collect(config);
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
      transport,
      source,
      trigger: options.trigger,
      rows: rows.length,
      unitPriced: rows.filter((row) => row.unitPrice !== null).length,
      pages: result.pages,
      ceilingReached,
      // A suppressed run applied no changes, and its summary must say so.
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

    if (suppressed) {
      await this.repository.openIncident(config.storeId, runId, "mass_change_suppressed", {
        rows: rows.length,
        changes: changes.length,
        reason: "over 90% of an established catalogue changed at once",
      });
    }

    // A fallback keeps the series unbroken; the incident is what keeps it
    // honest. The rows already say source='puller', so the substitution is
    // legible in the data as well as in the incident.
    if (fallbackReason) {
      await this.repository.openIncident(config.storeId, runId, "studio_failed", {
        reason: fallbackReason,
        covered_by: "puller",
        rows: rows.length,
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
   * Studio where a store needs a browser, HTTP everywhere else.
   *
   * Fifteen of the sixteen pullable stores have an HTTP path and cost no
   * credits. The one that does not falls back to HTTP when Studio cannot
   * collect, rather than losing the day's data point.
   */
  private async collect(config: PullerConfig): Promise<{
    result: PullResult;
    transport: "http" | "studio";
    fallbackReason: string | null;
  }> {
    if (config.needsBrowser) {
      try {
        const studio = this.registry.get("studio");
        if (!studio) throw new StudioError("no studio adapter registered");
        return { result: await studio.pull(config), transport: "studio", fallbackReason: null };
      } catch (error) {
        const reason = `${error instanceof Error ? error.name : "Error"}: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 200);
        this.logger.warn(`${config.storeId}: studio failed, falling back - ${reason}`);
        return { result: await this.overHttp(config), transport: "http", fallbackReason: reason };
      }
    }
    return { result: await this.overHttp(config), transport: "http", fallbackReason: null };
  }

  private async overHttp(config: PullerConfig): Promise<PullResult> {
    // sitemap-bounded is the same shape as sitemap with a lower ceiling, and
    // the ceiling is already a column.
    const method = config.method === "sitemap-bounded" ? "sitemap" : config.method;
    const puller = this.registry.get(method);
    if (!puller) throw new NotFoundException(`No puller registered for method ${config.method}.`);
    return puller.pull(config);
  }
}
