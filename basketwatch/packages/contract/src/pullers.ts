import { z } from "zod";
import { verdictSchema } from "./vocabulary.js";

/**
 * POST /api/pullers/:storeId/run
 *
 * Shapes for the manual trigger and its dry run. Dry run fetches and parses
 * exactly as a real run does but writes nothing, which is what makes a store's
 * config safe to change against production data.
 */
export const pullerRunQuerySchema = z.object({
  dryRun: z.coerce.boolean().default(false),
});
export type PullerRunQuery = z.infer<typeof pullerRunQuerySchema>;

export const pullerRunResponseSchema = z.object({
  storeId: z.string(),
  dryRun: z.boolean(),
  /** null on a dry run: nothing was written, so there is no run row */
  runId: z.string().nullable(),
  rows: z.number().int(),
  pages: z.number().int(),
  ceilingReached: z.boolean(),
  /** rows that would change a price, had this not been a dry run */
  changes: z.number().int(),
  verdict: verdictSchema.nullable(),
  durationMs: z.number().int(),
});
export type PullerRunResponse = z.infer<typeof pullerRunResponseSchema>;
