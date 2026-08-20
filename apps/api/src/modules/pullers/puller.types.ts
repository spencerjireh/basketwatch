import { type PullerRunResponse } from "@basketwatch/contract";

/**
 * The interface every store adapter implements.
 *
 * Crawl configuration is data, not code: method, endpoint, page ceiling and
 * category priorities come from the stores and scrapers tables (migration
 * 0001), so an adapter is only the shape-specific parsing -- Shopify
 * products.json, Magento GraphQL, JSON-LD product pages, bare HTML.
 */
export interface PullerConfig {
  storeId: string;
  method: string;
  endpoint: string | null;
  maxPages: number;
  needsBrowser: boolean;
  needsUnlocker: boolean;
}

export interface PullerRunOptions {
  /**
   * Fetch and parse exactly as a real run does, then write nothing. This is
   * what makes a config change safe to try against production data.
   */
  dryRun: boolean;
}

export interface Puller {
  readonly method: string;
  run(config: PullerConfig, options: PullerRunOptions): Promise<PullerRunResponse>;
}
