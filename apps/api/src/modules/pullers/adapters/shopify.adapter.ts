import { Injectable } from "@nestjs/common";
import { Fetcher, type FetchOptions } from "../fetcher.js";
import { type PullResult, type Puller, type PullerConfig, type PulledRow } from "../puller.types.js";
import { buildRow, siteOf } from "./row.js";

const PAGE_SIZE = 250;

type ShopifyVariant = { price?: string; available?: boolean };
type ShopifyProduct = {
  id?: number | string;
  title?: string;
  handle?: string;
  tags?: string[] | string;
  variants?: ShopifyVariant[];
};

/**
 * Shopify publishes its whole catalogue at /products.json, 250 per page.
 *
 * Ten of the sixteen pullable stores are Shopify. When `needs_unlocker` is set
 * on the store, requests route through Bright Data's Web Unlocker so all data
 * flows through BD infrastructure.
 */
@Injectable()
export class ShopifyAdapter implements Puller {
  readonly method = "shopify";

  constructor(private readonly fetcher: Fetcher) {}

  async pull(config: PullerConfig): Promise<PullResult> {
    if (!config.endpoint) return { rows: [], pages: 0 };
    const site = siteOf(config.endpoint);
    const rows: PulledRow[] = [];
    let pages = 0;
    const fetchOpts: FetchOptions = {
      useUnlocker: config.needsUnlocker,
      country: config.country,
    };

    // The ceiling is checked before each fetch, so a runaway crawl is
    // impossible by construction -- the failure mode that once produced 4,470
    // unintended rows.
    for (let page = 1; page <= config.maxPages; page += 1) {
      const response = await this.fetcher.get(
        `${config.endpoint}?limit=${PAGE_SIZE}&page=${page}`,
        fetchOpts,
      );
      pages += 1;
      if (response.status !== 200) break;

      const products = parseProducts(response.body);
      if (products === null || products.length === 0) break;

      for (const product of products) {
        const variant = product.variants?.[0] ?? {};
        const row = buildRow(config, {
          productKey: product.id ?? null,
          name: product.title ?? null,
          price: Number(variant.price),
          currency: null,
          url: `${site}/products/${product.handle}`,
          inStock: variant.available ?? true,
          category: Array.isArray(product.tags) ? product.tags.join(", ") : (product.tags ?? null),
        });
        if (row) rows.push(row);
      }

      // A short page is the natural end of the catalogue, ahead of the ceiling.
      if (products.length < PAGE_SIZE) break;
    }

    return { rows, pages };
  }
}

function parseProducts(body: string): ShopifyProduct[] | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const products = (parsed as { products?: unknown }).products;
    return Array.isArray(products) ? (products as ShopifyProduct[]) : null;
  } catch {
    return null;
  }
}
