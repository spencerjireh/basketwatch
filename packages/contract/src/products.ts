import { z } from "zod";
import {
  countrySchema,
  moneySchema,
  pageQuerySchema,
  pageSchema,
  timestampSchema,
} from "./primitives.js";

/**
 * The three ways a unit price can be quoted. Prices are only comparable within
 * one of them: "$0.40 each" and "$1.01 per kilo" are not two points on one
 * scale.
 */
export const unitPriceBasisSchema = z.enum(["per_kg", "per_litre", "per_item"]);
export type UnitPriceBasis = z.infer<typeof unitPriceBasisSchema>;

export const productSortSchema = z.enum(["relevance", "unit_price"]);
export type ProductSort = z.infer<typeof productSortSchema>;

/** One catalogue row, with whatever price we last saw against it. */
export const productHitSchema = z.object({
  storeId: z.string(),
  storeName: z.string(),
  country: countrySchema,
  productKey: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  /** null when the product is in the catalogue but has never been priced */
  price: moneySchema.nullable(),
  unitPrice: moneySchema.nullable(),
  unitPriceBasis: unitPriceBasisSchema.nullable(),
  /** the pack size normalised into sizeBaseUom; null when the title said nothing */
  sizeQuantity: z.number().nullable(),
  /** g | ml | count */
  sizeBaseUom: z.string().nullable(),
  /** the size is a range, a multipack, or labelled approximate */
  imprecise: z.boolean(),
  observedAt: timestampSchema.nullable(),
  /** the store's registry category: grocery, pharmacy, electronics, ... */
  category: z.string().nullable(),
  /** the last pull that saw the product in the store's catalogue */
  lastSeen: timestampSchema,
  /**
   * The most recent price changes, oldest first, at most 30: a sparkline, not
   * a history. History is change-only, so a flat price is one point.
   */
  spark: z.array(z.object({ d: z.iso.date(), p: z.number() })),
});
export type ProductHit = z.infer<typeof productHitSchema>;

/**
 * Products unseen for this long drop out of search and drops. Their product
 * pages stay, marked as no longer listed, so links and history keep working.
 */
export const LISTED_WITHIN_DAYS = 7;

/** A DTI suggested retail price that matches the search, shown as a reference row. */
export const srpReferenceSchema = z.object({
  category: z.string(),
  product: z.string(),
  size: z.string(),
  price: z.number(),
  effective: z.iso.date(),
});
export type SrpReference = z.infer<typeof srpReferenceSchema>;

/**
 * GET /api/products/search?q=rice&country=US
 *
 * `q` is optional, and leaving it out is the browse case: the whole catalogue,
 * alphabetically by name, every store mixed together. A search box that shows
 * nothing until you guess a product name hides 28,378 rows behind that guess.
 *
 * `sort` defaults to relevance rather than price, and that is not a hedge.
 * A US search for "rice" matches 261 per-kilo products, 5 per-item ones and 4
 * per-litre ones; sorting that union by bare unit price fills the first page
 * with five Regent Mochi rice cakes at $0.399 each while the cheapest actual
 * rice sits at $1.01 per kilo, unreachable. "Where is X cheapest" is two
 * questions, and the first one is whether the row is an X at all.
 *
 * `basis` is what makes a price sort mean something, and it is deliberately the
 * only facet. `products.category` carries whatever each store's own navigation
 * said, which in practice is "New, New Arrival, New Arrivals, New Item", "Best
 * Seller", "products" and "item". Exposing that as a filter would be teaching
 * the interface to trust a field that does not classify anything.
 */
export const productSearchQuerySchema = pageQuerySchema.extend({
  /*
   * Absent means the whole catalogue. One character is the only input refused,
   * and allowing none does not make that floor arbitrary -- absent is the
   * cheaper of the two, not the dearer. `%r%` matches 27,312 of 28,378 rows,
   * the trigram index cannot serve a leading wildcard, and every one of those
   * rows then has to be ranked by similarity. Absent skips both: no predicate,
   * and no sort key beyond the name index. The trigram index only starts
   * earning its keep at three characters.
   *
   * A blank string is read as absent rather than refused, so a stray `?q=` on
   * the URL browses instead of returning a 400.
   */
  q: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(2).max(100).optional(),
  ),
  country: countrySchema.optional(),
  storeId: z.string().optional(),
  /** the store's registry category; product-level categories are store junk (see above) */
  category: z.string().max(40).optional(),
  basis: unitPriceBasisSchema.optional(),
  sort: productSortSchema.default("relevance"),
});
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

export const productSearchResponseSchema = pageSchema(productHitSchema).extend({
  /** empty without a term, and on every page after the first */
  srp: z.array(srpReferenceSchema),
});
export type ProductSearchResponse = z.infer<typeof productSearchResponseSchema>;

/**
 * GET /api/products/drops?category=grocery
 *
 * A drop is a product whose latest price is at least 10% under its own 30-day
 * median, priced down within the last week and still listed. The median is
 * over the price steps in the window plus the price in effect when the window
 * opened (history is change-only), so a product needs two steps to qualify.
 */
export const DROP_THRESHOLD = 0.1;

export const dropsQuerySchema = z.object({
  category: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});
export type DropsQuery = z.infer<typeof dropsQuerySchema>;

export const dropSchema = productHitSchema.extend({
  median30: z.number(),
  /** 0.18 is 18% under the median */
  pctBelow: z.number(),
});
export type Drop = z.infer<typeof dropSchema>;

export const dropsResponseSchema = z.object({ items: z.array(dropSchema) });
export type DropsResponse = z.infer<typeof dropsResponseSchema>;

/** GET /api/products/:storeId/:productKey -- one product, all of its history. */
export const productDetailSchema = z.object({
  product: productHitSchema.omit({ spark: true }).extend({
    /** the size exactly as the store wrote it */
    unit: z.string().nullable(),
    firstSeen: timestampSchema,
  }),
  /** listed means seen within LISTED_WITHIN_DAYS */
  listed: z.boolean(),
  history: z.array(
    z.object({ at: timestampSchema, price: z.number(), unitPrice: z.number().nullable() }),
  ),
  low90: z.number().nullable(),
  median30: z.number().nullable(),
  /** listed products in other stores with the same parsed size and a similar name */
  sameSize: z.array(productHitSchema),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;
