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
  price: moneySchema,
  /** per kg / per litre / per item, so sizes compare honestly across stores */
  unitPrice: moneySchema.nullable(),
  unitPriceBasis: z.string().nullable(),
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
