import { z } from "zod";
import { countrySchema, timestampSchema } from "./primitives.js";
import { scraperStateSchema } from "./vocabulary.js";

/**
 * GET /api/fleet
 *
 * One row per fleet member. Note that a store is not a scraper: most stores are
 * pulled directly over HTTP and have no Studio collector, so `collectorId` is
 * nullable and `storeId` is the stable identity.
 */
export const fleetScraperSchema = z.object({
  storeId: z.string(),
  name: z.string(),
  country: countrySchema,
  /** collector_id from Scraper Studio; null for HTTP-pulled stores */
  collectorId: z.string().nullable(),
  status: scraperStateSchema,
  lastRunAt: timestampSchema.nullable(),
  lastRunRows: z.number().int(),
  nullRatePct: z.number(),
  healsToday: z.number().int(),
  /** set while the store is not healthy, so the board can link to the audit */
  openIncidentId: z.string().nullable(),
});
export type FleetScraper = z.infer<typeof fleetScraperSchema>;

export const fleetResponseSchema = z.array(fleetScraperSchema);
export type FleetResponse = z.infer<typeof fleetResponseSchema>;
