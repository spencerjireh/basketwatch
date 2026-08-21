import { z } from "zod";
import { checkResultSchema } from "./vocabulary.js";

// ---------------------------------------------------------------------------
// POST /api/heal/:scraperId/trigger
// ---------------------------------------------------------------------------

export const healTriggerBodySchema = z.object({
  /** Direct prompt, bypasses the auto-generated numbered list. */
  prompt: z.string().max(1000).optional(),
  /** Target URL for the heal preview. Falls back to the store endpoint. */
  url: z.string().url().optional(),
});
export type HealTriggerBody = z.infer<typeof healTriggerBodySchema>;

export const healTriggerResponseSchema = z.object({
  attemptId: z.string(),
  scraperId: z.string(),
  storeId: z.string().nullable(),
  incidentId: z.string(),
  prompt: z.string(),
  findings: z.array(checkResultSchema),
  status: z.enum(["pending_answer", "timeout", "error", "no_changes"]),
  previewResult: z.array(z.unknown()).nullable(),
  diffSummary: z.string().nullable(),
  durationMs: z.number(),
});
export type HealTriggerResponse = z.infer<typeof healTriggerResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/heal/:scraperId/approve | /reject
// ---------------------------------------------------------------------------

export const healDecisionResponseSchema = z.object({
  scraperId: z.string(),
  attemptId: z.string(),
  verdict: z.enum(["approved", "rejected"]),
});
export type HealDecisionResponse = z.infer<typeof healDecisionResponseSchema>;
