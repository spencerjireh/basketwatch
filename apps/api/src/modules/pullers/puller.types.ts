import { type Country, type PullerRunResponse } from "@basketwatch/contract";
import { type Size, type UnitPrice } from "./size.js";

/**
 * The interface every store adapter implements.
 *
 * Crawl configuration is data, not code: method, endpoint and page ceiling are
 * columns on `stores`, so an adapter is only the shape-specific parsing --
 * Shopify products.json, Magento GraphQL, JSON-LD product pages, bare HTML.
 * Changing where a store is crawled is a row edit, not a deploy.
 */
export interface PullerConfig {
  storeId: string;
  country: Country;
  currency: string;
  method: string;
  endpoint: string | null;
  maxPages: number;
}

/** One catalogue row as an adapter produces it, before any database sees it. */
export interface PulledRow {
  storeId: string;
  productKey: string;
  name: string;
  price: number;
  currency: string;
  url: string | null;
  inStock: boolean;
  category: string | null;
  observedAt: string;
  size: Size | null;
  unitPrice: UnitPrice | null;
}

/** What an adapter hands back: the rows it found and what it cost in fetches. */
export interface PullResult {
  rows: PulledRow[];
  pages: number;
}

export interface PullerRunOptions {
  /**
   * Fetch and parse exactly as a real run does, then write nothing. This is
   * what makes a config change safe to try against production data.
   */
  dryRun: boolean;
  /** cron | manual: recorded on the run row, so a schedule is legible later */
  trigger: "cron" | "manual";
}

export interface Puller {
  readonly method: string;
  pull(config: PullerConfig): Promise<PullResult>;
}

export type { PullerRunResponse };
