import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";
import { type PullResult, type Puller, type PullerConfig, type PulledRow } from "../puller.types.js";
import { parseSize } from "../size.js";
import { NO_SIZE, buildRow } from "./row.js";

const run = promisify(execFile);

/** Raised so the caller can fall back to HTTP and record why. */
export class StudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioError";
  }
}

/** An attempt count in the CLI's own polling loop, not seconds. */
const POLL_ATTEMPTS = 60;
const HARD_DEADLINE_MS = POLL_ATTEMPTS * 10_000 + 120_000;

type StudioRow = Record<string, unknown>;

/**
 * Collection through Scraper Studio, for the stores that need a browser.
 *
 * One store in the locked fleet needs this: ph-landers, which has no HTTP path
 * at all. It is also the only store in the fleet whose pulls cost Bright Data
 * credits, which is why every other store is routed over free HTTP.
 *
 * The CLI is subprocessed rather than reimplemented, following the same
 * decision the Python transport documents: `scraper run --input-file` does
 * trigger -> collection_id -> poll /dca/dataset with a three-way pending
 * sentinel and a realtime-page-limit fallback, and that is a lot of
 * undocumented semantics to reproduce for no gain.
 *
 * Consequence worth stating plainly: the `brightdata` CLI is not in the API
 * image today, so in the deploy this adapter throws StudioError, the run falls
 * back to the HTTP puller, and a `studio_failed` incident records the
 * substitution. That is the same path that produced the one incident already in
 * the database -- degraded, visible, and free.
 */
@Injectable()
export class StudioAdapter implements Puller {
  readonly method = "studio";
  private readonly logger = new Logger(StudioAdapter.name);

  async pull(config: PullerConfig): Promise<PullResult> {
    if (!config.collectorId) {
      throw new StudioError("no verified collector for this store");
    }

    const urls = seedUrls(config);
    if (urls.length === 0) throw new StudioError("no URLs to submit");

    const raw = await this.runCollector(config.collectorId, urls);
    const rows = this.toRows(config, raw);
    if (rows.length === 0) {
      throw new StudioError(`collector returned no usable rows for ${urls.length} URLs`);
    }
    return { rows, pages: urls.length };
  }

  private async runCollector(collectorId: string, urls: string[]): Promise<StudioRow[]> {
    // The URL list goes in a file, not on the command line: a 300-URL batch
    // exceeds the argv limit, and the CLI interleaves poll progress on stderr
    // with data on stdout.
    const dir = await mkdtemp(path.join(tmpdir(), "studio-"));
    const urlsFile = path.join(dir, "urls.txt");
    try {
      await writeFile(urlsFile, `${urls.join("\n")}\n`, "utf8");
      const { stdout } = await run(
        "brightdata",
        [
          "scraper",
          "run",
          collectorId,
          "--input-file",
          urlsFile,
          "--timeout",
          String(POLL_ATTEMPTS),
          "--json",
        ],
        // 64MB: a 300-URL batch is far larger than the default buffer, and an
        // overflow reads as a failed run rather than as a truncated one.
        { timeout: HARD_DEADLINE_MS, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      );
      const parsed: unknown = JSON.parse(stdout);
      if (Array.isArray(parsed)) return parsed as StudioRow[];
      const wrapped = parsed as { data?: unknown; results?: unknown };
      const rows = wrapped.data ?? wrapped.results;
      return Array.isArray(rows) ? (rows as StudioRow[]) : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`studio run failed for ${collectorId}: ${detail}`);
      throw new StudioError(detail.slice(0, 200));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private toRows(config: PullerConfig, raw: StudioRow[]): PulledRow[] {
    const rows: PulledRow[] = [];
    for (const item of raw) {
      const url = firstString(item.url, item.page_url, item.input_url);
      const price = coercePrice(item.price);
      if (!url || price === null) continue;

      const name = firstString(item.name, item.title);
      const row = buildRow(config, {
        // Derived here, never taken from Studio. If a collector invented a key
        // from a SKU while the puller used the URL slug, the first fallback run
        // would report the whole catalogue as new and overwrite the price
        // history -- the one thing in this project that cannot be re-collected.
        productKey: keyFromUrl(url),
        name,
        price,
        currency: firstString(item.currency),
        url,
        inStock: item.in_stock !== false,
        category: firstString(item.category),
        rawSize: reconcileSize(firstString(item.size), name),
        source: "studio",
      });
      if (row?.name) rows.push(row);
    }
    return rows;
  }
}

/**
 * The bounded URL list Studio is handed.
 *
 * Bounding happens before the subprocess is spawned, because that is where the
 * money is. Nothing downstream can widen it.
 */
function seedUrls(config: PullerConfig): string[] {
  if (!config.endpoint) return [];
  const base = config.endpoint.split("?")[0]!;
  return Array.from({ length: Math.max(0, config.maxPages) }, (_, i) => `${base}?page=${i + 1}`);
}

/**
 * Where a collector's own size disagrees with the title's, emit no size at all.
 *
 * A size that is wrong produces a unit price that is wrong, and a wrong unit
 * price is worse than a missing one: it compares as if it were true.
 */
function reconcileSize(collectorSize: string | null, name: string | null): string | null | typeof NO_SIZE {
  if (!collectorSize) return name;
  const fromCollector = parseSize(collectorSize);
  const fromName = parseSize(name ?? "");
  if (!fromCollector || !fromName) return collectorSize;
  const agrees =
    fromCollector.baseUom === fromName.baseUom &&
    Math.abs(fromCollector.quantity - fromName.quantity) < 0.001;
  return agrees ? collectorSize : NO_SIZE;
}

const RE_PRICE = /[-+]?\d[\d,\s]*(?:\.\d+)?/;

/** Studio prices arrive as whatever the page showed: "PHP 389.50", "$4.49", "1,234.00". */
export function coercePrice(value: unknown): number | null {
  if (typeof value === "number") return value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = RE_PRICE.exec(value);
  if (!match) return null;
  const price = Number.parseFloat(match[0].replace(/[,\s]/g, ""));
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function keyFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "").split("/").at(-1) || url;
  } catch {
    return url;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
