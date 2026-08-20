import { DEFAULT_CURRENCY_BY_COUNTRY } from "@basketwatch/contract";
import { type PulledRow, type PullerConfig } from "../puller.types.js";
import { parseSize, unitPrice, type Size } from "../size.js";

/** "the size is not knowable", as distinct from "read it off the name". */
export const NO_SIZE = Symbol("no-size");

type RowInput = {
  productKey: string | number | null;
  name: string | null;
  price: number;
  currency?: string | null;
  url: string | null;
  inStock?: boolean;
  category?: string | null;
  /** pass NO_SIZE where the collector's own size contradicts the title's */
  rawSize?: string | null | typeof NO_SIZE;
  source?: "puller" | "studio";
};

/**
 * One catalogue row, shaped once so every adapter agrees.
 *
 * Sizes are parsed here rather than per adapter, because a store that reports a
 * size differently from its own titles would otherwise produce unit prices that
 * are not comparable with anyone else's.
 */
export function buildRow(config: PullerConfig, input: RowInput): PulledRow | null {
  if (!Number.isFinite(input.price) || input.price <= 0) return null;
  const productKey = input.productKey === null ? "" : String(input.productKey);
  if (!productKey) return null;

  const size: Size | null =
    input.rawSize === NO_SIZE ? null : parseSize(input.rawSize ?? input.name ?? "");

  return {
    storeId: config.storeId,
    productKey,
    name: (input.name ?? "").trim().slice(0, 200),
    price: input.price,
    // Shopify publishes no currency at all, so the store's own is the fallback
    // and a source-provided value wins.
    currency: input.currency || config.currency || DEFAULT_CURRENCY_BY_COUNTRY[config.country],
    url: input.url,
    inStock: input.inStock ?? true,
    category: input.category ?? null,
    observedAt: now(),
    size,
    unitPrice: unitPrice(input.price, size),
    source: input.source ?? "puller",
  };
}

/**
 * UTC with a Z suffix.
 *
 * zod's .datetime() rejects a "+00:00" offset unless offset:true is set, and
 * the contract does not set it -- so an offset-form timestamp fails validation
 * on every row. Found once by running catalogue rows through validateRun.
 */
export function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The scheme and host of an endpoint, for building product URLs against it. */
export function siteOf(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}
