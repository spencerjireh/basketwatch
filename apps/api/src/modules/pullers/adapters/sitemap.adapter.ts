import { Injectable, Logger } from "@nestjs/common";
import { Fetcher, type FetchOptions } from "../fetcher.js";
import {
  type PullResult,
  type Puller,
  type PullerConfig,
  type PulledRow,
} from "../puller.types.js";
import { extractProduct } from "./product-page.js";
import { parseSitemap, rankProductUrls } from "./sitemap.js";
import { buildRow, siteOf } from "./row.js";

/** A sitemap index can nest; two levels covers every store in the fleet. */
const MAX_SITEMAP_DEPTH = 2;

/**
 * One fetch per product, for the four stores with no bulk endpoint.
 *
 * This is the expensive shape -- Dierbergs' ceiling of 400 pages is 400 HTTP
 * round trips for 400 products, against 250 products per call on Shopify -- so
 * URLs are ranked before any is fetched and the ceiling is a hard stop.
 *
 * When `needs_unlocker` is set, all requests route through Bright Data's Web
 * Unlocker.
 */
@Injectable()
export class SitemapAdapter implements Puller {
  readonly method = "sitemap";
  private readonly logger = new Logger(SitemapAdapter.name);

  constructor(private readonly fetcher: Fetcher) {}

  async pull(config: PullerConfig): Promise<PullResult> {
    if (!config.endpoint) return { rows: [], pages: 0 };

    const fetchOpts: FetchOptions = {
      useUnlocker: config.needsUnlocker,
      country: config.country,
    };

    const { urls, pages: discoveryPages } = await this.discover(config.endpoint, fetchOpts);
    const ranked = rankProductUrls(urls).slice(0, config.maxPages);
    this.logger.log(
      `${config.storeId}: ${urls.length} urls in the sitemap, ${ranked.length} worth fetching`,
    );

    const rows: PulledRow[] = [];
    let pages = discoveryPages;

    for (const url of ranked) {
      if (pages >= config.maxPages) break;
      const response = await this.fetcher.get(url, fetchOpts);
      pages += 1;
      if (response.status !== 200) continue;

      const product = extractProduct(response.body);
      if (!product) continue;

      const row = buildRow(config, {
        productKey: slugOf(url),
        name: product.name,
        price: product.price,
        currency: product.currency,
        url,
        category: categoryOf(url),
      });
      if (row) rows.push(row);
    }

    return { rows, pages };
  }

  private async discover(
    endpoint: string,
    fetchOpts: FetchOptions,
  ): Promise<{ urls: string[]; pages: number }> {
    const site = siteOf(endpoint);
    const start = endpoint.includes("sitemap") ? endpoint : `${site}/sitemap.xml`;

    let queue = [start];
    const urls: string[] = [];
    let pages = 0;

    for (let depth = 0; depth <= MAX_SITEMAP_DEPTH && queue.length > 0; depth += 1) {
      const next: string[] = [];
      for (const target of queue.slice(0, 20)) {
        const response = await this.fetcher.get(target, fetchOpts);
        pages += 1;
        if (response.status !== 200) continue;
        const parsed = parseSitemap(response.body);
        urls.push(...parsed.pages);
        next.push(...parsed.sitemaps);
      }
      queue = next;
    }

    return { urls, pages };
  }
}

function slugOf(url: string): string {
  return new URL(url).pathname.replace(/\/$/, "").split("/").at(-1) ?? url;
}

function categoryOf(url: string): string | null {
  const segments = new URL(url).pathname.split("/").filter(Boolean).slice(0, -1);
  return segments.length > 0 ? segments.join("/") : null;
}
