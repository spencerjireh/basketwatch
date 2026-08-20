import { z } from "zod";
import { countrySchema, currencyCodeSchema, moneySchema } from "./primitives.js";

/**
 * A single day on the index.
 *
 * `total` is nullable, and that null is the product. It means no trustworthy
 * data existed for that day, and the chart renders it as a visible gap rather
 * than interpolating across it. A smooth line here would be a lie.
 */
export const basketPointSchema = z.object({
  date: z.iso.date(),
  total: z.number().nullable(),
  /** the day a heal closed the preceding gap */
  healed: z.boolean().optional(),
  /** set on gap days, so the chart can label the scar and link to the audit */
  incidentId: z.string().nullable().optional(),
  /** how many of the basket's items had a usable price on this day */
  pricedItems: z.number().int(),
  /** how many the basket expects; a day is only totalled when the two match */
  expectedItems: z.number().int(),
  /**
   * The items with no usable price on this day, named.
   *
   * "8 of 10 priced" is the honest headline for a partial day, but it is only
   * actionable if the reader can see *which* two are missing. The first day of
   * history is the case that proves it: 19 Aug holds five observations, all US,
   * so its point is five priced and five missing. Without the names that reads
   * as an outage. With them it reads as the day tracking began, which is what
   * it was.
   */
  missingItemKeys: z.array(z.string()),
});
export type BasketPoint = z.infer<typeof basketPointSchema>;

/**
 * GET /api/basket/index?country=US
 *
 * One series per country. Currencies are never mixed within a series, which is
 * exactly what lets the comparison view show US and PH honestly side by side
 * instead of pretending one exchange rate makes them one number.
 */
export const basketSeriesSchema = z.object({
  country: countrySchema,
  currency: currencyCodeSchema,
  points: z.array(basketPointSchema),
});
export type BasketSeries = z.infer<typeof basketSeriesSchema>;

export const basketIndexResponseSchema = z.array(basketSeriesSchema);
export type BasketIndexResponse = z.infer<typeof basketIndexResponseSchema>;

/** GET /api/basket/today?country=US */
export const basketItemSchema = z.object({
  itemKey: z.string(),
  label: z.string(),
  /** the pack size as tracked, e.g. "1 gal", "5 kg" */
  unit: z.string(),
  country: countrySchema,
  cheapestStoreId: z.string(),
  cheapestStoreName: z.string(),
  /**
   * The product the price actually came from.
   *
   * On the wire because ranking by unit price surfaces mispins that ranking by
   * sticker price hid, and no threshold rule can catch them: they are cheap,
   * not expensive. Printing the name is the only thing that makes them visible,
   * and visible is what makes them fixable.
   */
  productName: z.string(),
  price: moneySchema,
  /** per kg / per litre / per item, so sizes compare honestly across stores */
  unitPrice: moneySchema.nullable(),
  unitPriceBasis: z.string().nullable(),
  /** how much of this item one basket buys: 5 kg of rice, 12 eggs */
  indexQuantity: z.number().nullable(),
  /** kg | l | count */
  indexUom: z.string().nullable(),
  /** unitPrice x indexQuantity: this line's share of the headline total */
  indexContribution: moneySchema.nullable(),
  /** the size is real but fuzzy -- a range, a multipack, or labelled "approx" */
  imprecise: z.boolean(),
  /** percent change against the previous observation; 0 means unchanged */
  deltaPct: z.number(),
});
export type BasketItem = z.infer<typeof basketItemSchema>;

export const basketTodayResponseSchema = z.array(basketItemSchema);
export type BasketTodayResponse = z.infer<typeof basketTodayResponseSchema>;

/** Both basket endpoints take an optional country; omit it to get every one. */
export const basketQuerySchema = z.object({
  country: countrySchema.optional(),
});
export type BasketQuery = z.infer<typeof basketQuerySchema>;

/**
 * What we think of a pin.
 *
 * `suspect` means the pin is probably not this item at all -- a wholesale case
 * price standing in for a retail one, a bouillon cube pinned as chicken. Those
 * are excluded from the index and from the cheapest and dearest labels.
 *
 * `imprecise` means the size is real but fuzzy, and it still counts. That
 * second tier is not softness. The only Philippine banana pin we hold is a
 * 740g-750g range, and calling a range suspect would drop the bananas line,
 * which nulls the whole PH basket on every day of the chart. A midpoint is
 * worth saying out loud; it is not worth throwing the item away over.
 */
export const railFlagSchema = z.enum(["ok", "imprecise", "suspect"]);
export type RailFlag = z.infer<typeof railFlagSchema>;

/** One pin on a rail: a concrete product, at a concrete store. */
export const railPinSchema = z.object({
  storeId: z.string(),
  storeName: z.string(),
  /** false for a store the index ignores; the pin is still drawn on the rail */
  indexContributor: z.boolean(),
  productKey: z.string(),
  productName: z.string(),
  /** null when the pin exists but no observation has landed against it yet */
  price: moneySchema.nullable(),
  unitPrice: moneySchema.nullable(),
  unitPriceBasis: z.string().nullable(),
  flag: railFlagSchema,
  /** plain-language reason; null when the flag is "ok" */
  flagReason: z.string().nullable(),
  /** both are computed over the non-suspect pins only */
  cheapest: z.boolean(),
  dearest: z.boolean(),
});
export type RailPin = z.infer<typeof railPinSchema>;

/**
 * GET /api/basket/rails?country=US
 *
 * Every pin for one item, not just the winner. This is the view that answers
 * "where does the same staple cost different money", which is a question three
 * days of history cannot yet answer over time but nineteen stores can answer
 * right now.
 */
export const railSchema = z.object({
  itemKey: z.string(),
  label: z.string(),
  country: countrySchema,
  currency: currencyCodeSchema,
  indexQuantity: z.number().nullable(),
  indexUom: z.string().nullable(),
  /** the yardstick the suspect threshold is measured against */
  medianUnitPrice: moneySchema.nullable(),
  /** below three priced pins the price rule is off; say so rather than imply a check */
  comparable: z.boolean(),
  pins: z.array(railPinSchema),
});
export type Rail = z.infer<typeof railSchema>;

export const basketRailsResponseSchema = z.array(railSchema);
export type BasketRailsResponse = z.infer<typeof basketRailsResponseSchema>;

/**
 * Rails default to the ten core items, which are the ones the basket totals.
 * The quality worklist asks for core and stretch, because a mispin on a stretch
 * item is exactly as wrong -- it is just not in the headline number.
 */
export const railsQuerySchema = z.object({
  country: countrySchema.optional(),
  tier: z.enum(["core", "core,stretch"]).default("core"),
});
export type RailsQuery = z.infer<typeof railsQuerySchema>;
