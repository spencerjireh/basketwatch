import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";
import { Fetcher, type FetchOptions } from "../fetcher.js";
import { type PullResult, type Puller, type PullerConfig, type PulledRow } from "../puller.types.js";
import { parseSize } from "../size.js";
import { NO_SIZE, buildRow, siteOf } from "./row.js";
import { parseSitemap, rankProductUrls } from "./sitemap.js";

const run = promisify(execFile);

/**
 * Why a Studio pull failed, which decides whether healing it is even coherent.
 *
 * The distinction earns its keep in credits. A heal rewrites the extraction
 * template, so it can only fix a scraper whose template is wrong -- and until
 * now every failure looked identical, so a store that merely ran slowly was
 * sent to Bright Data for repair alongside one whose selectors had genuinely
 * moved.
 *
 * - `broken`       Studio ran and returned rows, but none survived parsing.
 *                  The fields moved. This is the only kind worth healing.
 * - `timeout`      the CLI was killed at the hard deadline. Says nothing about
 *                  the template; the store is probably just large.
 * - `empty`        Studio ran and returned nothing at all. Could be a dead
 *                  collector or a genuinely empty catalogue -- either way a
 *                  template rewrite is a guess.
 * - `no_urls`      discovery produced nothing to submit. The sitemap fetch is
 *                  our code, not Studio's, so no template change can fix it.
 * - `unprovisioned` no collector exists yet. A provisioning gap, not a break.
 */
export type StudioFailureKind = "broken" | "timeout" | "empty" | "no_urls" | "unprovisioned";

/** Raised so the caller can diagnose the failure and decide about a heal. */
export class StudioError extends Error {
  constructor(
    message: string,
    /** Positional and required: adding a throw site should force this choice. */
    readonly kind: StudioFailureKind,
    /** The raw JSON Studio returned before normalization failed, if any. */
    readonly rawOutput: unknown[] = [],
    /** Exit code, signal and stderr tail -- kept for the incident evidence. */
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StudioError";
  }
}

/** An attempt count in the CLI's own polling loop, not seconds. */
const POLL_ATTEMPTS = 60;
const HARD_DEADLINE_MS = POLL_ATTEMPTS * 10_000 + 120_000;

type StudioRow = Record<string, unknown>;

/**
 * Collection through Scraper Studio -- the only production transport.
 *
 * The CLI is subprocessed rather than reimplemented, following the same
 * decision the Python transport documents: `scraper run --input-file` does
 * trigger -> collection_id -> poll /dca/dataset with a three-way pending
 * sentinel and a realtime-page-limit fallback, and that is a lot of
 * undocumented semantics to reproduce for no gain.
 */
/** Max depth for nested sitemap indices during URL discovery. */
const MAX_SITEMAP_DEPTH = 2;

@Injectable()
export class StudioAdapter implements Puller {
  readonly method = "studio";
  private readonly logger = new Logger(StudioAdapter.name);
  private readonly apiKey = process.env.BRIGHTDATA_API_KEY ?? "";

  constructor(private readonly fetcher: Fetcher) {}

  async pull(config: PullerConfig): Promise<PullResult> {
    if (!config.collectorId) {
      throw new StudioError("no verified collector for this store", "unprovisioned");
    }

    const urls = await this.seedUrls(config);
    if (urls.length === 0) throw new StudioError("no URLs to submit", "no_urls");

    const raw = await this.runCollector(config.collectorId, urls);
    const rows = this.toRows(config, raw);
    if (rows.length === 0) {
      // raw.length > 0 means Studio itself worked and the fields moved under
      // us, which is the one failure a template rewrite can actually repair.
      throw new StudioError(
        `collector returned no usable rows for ${urls.length} URLs`,
        raw.length > 0 ? "broken" : "empty",
        raw.slice(0, 10),
        { urlsSubmitted: urls.length, rawRows: raw.length },
      );
    }
    return { rows, pages: urls.length, rawOutput: raw.slice(0, 20) };
  }

  /**
   * Build the bounded URL list Studio is handed.
   *
   * Two strategies depending on store method:
   * - Listing-page stores (shopify, magento): paginate the studioEndpoint
   * - Sitemap stores: discover product URLs from the sitemap and feed them
   *   one-per-URL to the product-page collector
   */
  private async seedUrls(config: PullerConfig): Promise<string[]> {
    const isSitemap = config.method === "sitemap" || config.method === "sitemap-bounded";

    if (isSitemap) {
      return this.discoverProductUrls(config);
    }

    const ep = config.studioEndpoint ?? config.endpoint;
    if (!ep) return [];
    const base = ep.split("?")[0]!;
    return Array.from({ length: Math.max(0, config.maxPages) }, (_, i) => `${base}?page=${i + 1}`);
  }

  /**
   * Discover product URLs from a store's sitemap. Uses the same sitemap
   * parsing and product-URL ranking as the SitemapAdapter, but only returns
   * URLs -- Studio's product-page collector handles the extraction.
   */
  private async discoverProductUrls(config: PullerConfig): Promise<string[]> {
    const endpoint = config.studioEndpoint ?? config.endpoint;
    const site = siteOf(endpoint ?? `https://${config.storeId.replace(/^[a-z]+-/, "")}.com`);
    const start = endpoint?.includes("sitemap") ? endpoint : `${site}/sitemap.xml`;

    const fetchOpts: FetchOptions = {
      useUnlocker: config.needsUnlocker,
      country: config.country,
    };

    let queue = [start];
    const allUrls: string[] = [];

    for (let depth = 0; depth <= MAX_SITEMAP_DEPTH && queue.length > 0; depth += 1) {
      const next: string[] = [];
      for (const target of queue.slice(0, 20)) {
        const response = await this.fetcher.get(target, fetchOpts);
        if (response.status !== 200) continue;
        const parsed = parseSitemap(response.body);
        allUrls.push(...parsed.pages);
        next.push(...parsed.sitemaps);
      }
      queue = next;
    }

    const ranked = rankProductUrls(allUrls).slice(0, config.maxPages);
    this.logger.log(
      `${config.storeId}: sitemap yielded ${allUrls.length} URLs, ` +
        `${ranked.length} product URLs after ranking (cap ${config.maxPages})`,
    );
    return ranked;
  }

  private async runCollector(collectorId: string, urls: string[]): Promise<StudioRow[]> {
    // The URL list goes in a file, not on the command line: a 300-URL batch
    // exceeds the argv limit, and the CLI interleaves poll progress on stderr
    // with data on stdout.
    const dir = await mkdtemp(path.join(tmpdir(), "studio-"));
    const urlsFile = path.join(dir, "urls.txt");
    try {
      await writeFile(urlsFile, `${urls.join("\n")}\n`, "utf8");
      const args = [
        ...(this.apiKey ? ["-k", this.apiKey] : []),
        "scraper",
        "run",
        collectorId,
        "--input-file",
        urlsFile,
        "--timeout",
        String(POLL_ATTEMPTS),
        "--json",
      ];
      const { stdout } = await run(
        "brightdata",
        args,
        // 64MB: a 300-URL batch is far larger than the default buffer, and an
        // overflow reads as a failed run rather than as a truncated one.
        { timeout: HARD_DEADLINE_MS, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      );
      const parsed: unknown = JSON.parse(stdout);
      if (Array.isArray(parsed)) return parsed as StudioRow[];
      const wrapped = parsed as { data?: unknown; results?: unknown };
      const rows = wrapped.data ?? wrapped.results;
      if (Array.isArray(rows)) return rows as StudioRow[];
      // Returning [] here would have been reported as "empty" -- Studio sent
      // something we could not read, which is a broken shape, not no data.
      throw new StudioError("collector returned an unrecognised JSON envelope", "broken", [parsed]);
    } catch (error) {
      if (error instanceof StudioError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      // execFile kills the child at `timeout` with SIGTERM and sets killed.
      // That is the only signal separating "ran out of time" from "broke",
      // and it was being discarded with the rest of the error object.
      const e = error as { killed?: boolean; signal?: string; code?: string; stderr?: string };
      const timedOut = e.killed === true || e.signal === "SIGTERM";
      this.logger.warn(
        `studio run failed for ${collectorId} (${timedOut ? "timeout" : "error"}): ${detail}`,
      );
      throw new StudioError(detail.slice(0, 200), timedOut ? "timeout" : "broken", [], {
        code: e.code ?? null,
        signal: e.signal ?? null,
        killed: e.killed ?? false,
        stderrTail: (e.stderr ?? "").slice(-500),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private toRows(config: PullerConfig, raw: StudioRow[]): PulledRow[] {
    const flat = flattenRows(raw);
    const rows: PulledRow[] = [];
    for (const item of flat) {
      const url = firstString(
        item.url,
        item.page_url,
        item.product_url,
        item.product_page_url,
        item.input_url,
        (item.input as Record<string, unknown>)?.url,
      );
      const price = coercePrice(item.price);
      if (!url || price === null) continue;

      const name = firstString(item.name, item.title, item.product_name);
      const row = buildRow(config, {
        productKey: keyFromUrl(url),
        name,
        price,
        currency: normaliseCurrency(firstString(item.currency)),
        url,
        inStock: item.in_stock !== false,
        category: firstString(item.category),
        rawSize: reconcileSize(firstString(item.size, item.size_or_weight), name),
        source: "studio",
      });
      if (row?.name) rows.push(row);
    }
    return rows;
  }
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

/** Studio prices arrive as whatever the page showed: "PHP 389.50", "$4.49", "1,234.00", or {value: 6.99, currency: "USD"}. */
export function coercePrice(value: unknown): number | null {
  if (typeof value === "number") return value > 0 ? value : null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return coercePrice(obj.value ?? obj.amount ?? obj.price);
  }
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

/**
 * Listing-page collectors sometimes nest products inside a wrapper:
 * `[{products: [...], input: {...}}]`. Flatten so toRows sees individual items.
 */
function flattenRows(raw: StudioRow[]): StudioRow[] {
  const out: StudioRow[] = [];
  for (const item of raw) {
    const nested = item.products ?? item.items ?? item.results;
    if (Array.isArray(nested) && nested.length > 0) {
      for (const child of nested) {
        if (child && typeof child === "object") out.push(child as StudioRow);
      }
    } else {
      out.push(item);
    }
  }
  return out;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "\u20B1": "PHP",
  "\u20AC": "EUR",
  "\u00A3": "GBP",
};

function normaliseCurrency(raw: string | null): string | null {
  if (!raw) return null;
  return CURRENCY_SYMBOLS[raw] ?? raw;
}
