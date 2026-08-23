import { Injectable } from "@nestjs/common";
import { Fetcher, type FetchOptions } from "../fetcher.js";
import {
  type PullResult,
  type Puller,
  type PullerConfig,
  type PulledRow,
} from "../puller.types.js";
import { buildRow, siteOf } from "./row.js";

/**
 * Magento rejects an open price filter, but its category tree is queryable and
 * gives real category labels for free. SM Markets exposes 60,099 products this
 * way, with live PHP prices, on a public endpoint.
 *
 * These two query strings are the load-bearing part of the adapter. They were
 * derived against smmarkets.ph and live nowhere else -- fleet.lock.json records
 * only the endpoint.
 */
const CATEGORIES_QUERY = "{categories(filters:{}){items{uid name product_count}}}";
const PRODUCTS_QUERY = (uid: string, page: number) =>
  `{products(filter:{category_uid:{eq:"${uid}"}},pageSize:${CATEGORY_PAGE_SIZE},currentPage:${page})` +
  `{total_count items{name sku url_key price_range{minimum_price{final_price{value currency}}}}}}`;

const CATEGORY_PAGE_SIZE = 100;

type Category = { uid?: string; name?: string; product_count?: number };
type Product = {
  name?: string;
  sku?: string;
  url_key?: string;
  price_range?: { minimum_price?: { final_price?: { value?: number; currency?: string } } };
};

@Injectable()
export class MagentoGraphqlAdapter implements Puller {
  readonly method = "magento-graphql";

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

    const tree = await this.query<{ categories?: { items?: Category[] } }>(
      config.endpoint,
      CATEGORIES_QUERY,
      fetchOpts,
    );
    pages += 1;

    const categories = (tree?.categories?.items ?? [])
      .filter((c) => (c.product_count ?? 0) > 0 && c.name !== "Default Category")
      .sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0));

    for (const category of categories) {
      if (pages >= config.maxPages || !category.uid) break;

      for (let page = 1; page < 100; page += 1) {
        if (pages >= config.maxPages) break;
        const data = await this.query<{ products?: { items?: Product[] } }>(
          config.endpoint,
          PRODUCTS_QUERY(category.uid, page),
          fetchOpts,
        );
        pages += 1;

        const items = data?.products?.items ?? [];
        if (items.length === 0) break;

        for (const item of items) {
          const finalPrice = item.price_range?.minimum_price?.final_price;
          const row = buildRow(config, {
            productKey: item.sku ?? null,
            name: item.name ?? null,
            price: Number(finalPrice?.value),
            currency: finalPrice?.currency ?? null,
            url: `${site}/${item.url_key}.html`,
            category: category.name ?? null,
          });
          if (row) rows.push(row);
        }

        if (items.length < CATEGORY_PAGE_SIZE) break;
      }
    }

    return { rows, pages };
  }

  private async query<T>(
    endpoint: string,
    query: string,
    fetchOpts: FetchOptions,
  ): Promise<T | null> {
    const response = await this.fetcher.get(
      `${endpoint}?query=${encodeURIComponent(query)}`,
      fetchOpts,
    );
    if (response.status !== 200) return null;
    try {
      return (JSON.parse(response.body) as { data?: T }).data ?? null;
    } catch {
      return null;
    }
  }
}
