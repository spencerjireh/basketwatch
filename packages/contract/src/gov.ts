import { z } from "zod";

/**
 * Government price series: DOE weekly pump prices and monthly LPG, the DOE Oil
 * Monitor's weekly adjustments, DA Bantay Presyo daily wet-market prices, and
 * DTI suggested retail prices (SRPs). Dates are ISO calendar dates
 * (YYYY-MM-DD); money is in pesos.
 */

export const govSources = [
  "doe_pump",
  "doe_oil_monitor",
  "doe_lpg",
  "bantay_presyo",
  "dti_srp",
] as const;
export const govSourceSchema = z.enum(govSources);
export type GovSource = z.infer<typeof govSourceSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A min-max pair: DOE reports ranges; a single figure has min = max. */
export const priceRangeSchema = z.object({ min: z.number(), max: z.number() });
export type PriceRange = z.infer<typeof priceRangeSchema>;

export const periodSchema = z.object({ start: isoDate, end: isoDate });

/** GET /api/gov/fuel?region=NCR&product=RON 95 */
export const fuelQuerySchema = z.object({
  region: z.string().default("NCR"),
  product: z.string().default("RON 95"),
});
export type FuelQuery = z.infer<typeof fuelQuerySchema>;

export const fuelResponseSchema = z.object({
  region: z.string(),
  product: z.string(),
  /** products DOE lists for the region in the latest week */
  products: z.array(z.string()),
  week: periodSchema.nullable(),
  /** the week's pump-price adjustment for this fuel, from the Oil Monitor */
  adjustment: priceRangeSchema.extend({ effective: isoDate }).nullable(),
  /** per city, brands sorted by their lowest price */
  cities: z.array(
    z.object({
      city: z.string(),
      brands: z.array(priceRangeSchema.extend({ brand: z.string() })),
    }),
  ),
  /** the region-wide lowest and highest this week */
  range: priceRangeSchema.nullable(),
  /** median of every brand's lowest price, per week, oldest first */
  history: z.array(z.object({ weekStart: isoDate, median: z.number() })),
});
export type FuelResponse = z.infer<typeof fuelResponseSchema>;

/** GET /api/gov/lpg -- the 11-kg cylinder in Metro Manila, per month. */
export const lpgResponseSchema = z.object({
  unit: z.string(),
  months: z.array(priceRangeSchema.extend({ month: isoDate })),
});
export type LpgResponse = z.infer<typeof lpgResponseSchema>;

/** GET /api/gov/markets?commodity=Rice */
export const marketsQuerySchema = z.object({ commodity: z.string().optional() });
export type MarketsQuery = z.infer<typeof marketsQuerySchema>;

export const marketsResponseSchema = z.object({
  date: isoDate.nullable(),
  /** commodity groups available on that date */
  commodities: z.array(z.string()),
  rows: z.array(
    z.object({
      commodity: z.string(),
      variant: z.string(),
      unit: z.string(),
      markets: z.array(z.object({ market: z.string(), price: z.number() })),
    }),
  ),
});
export type MarketsResponse = z.infer<typeof marketsResponseSchema>;

/** GET /api/gov/srp?q=sardines */
export const srpQuerySchema = z.object({ q: z.string().optional() });
export type SrpQuery = z.infer<typeof srpQuerySchema>;

export const srpResponseSchema = z.object({
  effective: isoDate.nullable(),
  items: z.array(
    z.object({ category: z.string(), product: z.string(), size: z.string(), price: z.number() }),
  ),
});
export type SrpResponse = z.infer<typeof srpResponseSchema>;
