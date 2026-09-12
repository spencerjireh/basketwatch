import { z } from "zod";
import { countrySchema, timestampSchema } from "./primitives.js";
import { scraperStateSchema } from "./vocabulary.js";

/**
 * GET /api/fleet
 *
 * One row per registered store; `storeId` is the stable identity.
 */
export const fleetScraperSchema = z.object({
  storeId: z.string(),
  name: z.string(),
  country: countrySchema,
  status: scraperStateSchema,
  lastRunAt: timestampSchema.nullable(),
  lastRunRows: z.number().int(),
  nullRatePct: z.number(),
  /** set while the store is not healthy, so the board can link to the incident */
  openIncidentId: z.string().nullable(),
  /** true when the store is active and stores.method is not 'none' -- can trigger a pull */
  isPullable: z.boolean(),
});
export type FleetScraper = z.infer<typeof fleetScraperSchema>;

export const fleetResponseSchema = z.array(fleetScraperSchema);
export type FleetResponse = z.infer<typeof fleetResponseSchema>;

/**
 * POST /api/fleet/:storeId/index-contributor
 *
 * Flip whether a store's prices count toward the country index. The index
 * filters on stores.index_contributor at query time, so the flip is
 * retroactive over the store's whole history -- built for the clone stores,
 * which launch excluded and join only by an explicit operator decision.
 */
export const indexContributorBodySchema = z.object({
  contributor: z.boolean(),
});
export type IndexContributorBody = z.infer<typeof indexContributorBodySchema>;
