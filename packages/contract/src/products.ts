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
});
export type ProductHit = z.infer<typeof productHitSchema>;

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
  basis: unitPriceBasisSchema.optional(),
  sort: productSortSchema.default("relevance"),
});
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

export const productSearchResponseSchema = pageSchema(productHitSchema);
export type ProductSearchResponse = z.infer<typeof productSearchResponseSchema>;
