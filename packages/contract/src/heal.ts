import { z } from "zod";
import { timestampSchema } from "./primitives.js";
import { checkResultSchema, incidentKindSchema } from "./vocabulary.js";

// ---------------------------------------------------------------------------
// GET /api/heal/:scraperId/preview-prompt
// ---------------------------------------------------------------------------

/** Incident context surfaced before the user triggers a heal. */
const incidentContextSchema = z.object({
  id: z.string(),
  kind: incidentKindSchema,
  openedAt: timestampSchema,
  failedChecks: z.array(checkResultSchema),
  fieldNullRates: z.record(z.string(), z.number()),
  baselineNullRates: z.record(z.string(), z.number()),
  sampleBadRows: z.array(z.unknown()),
  rowCount: z.number().int(),
  expectedRowCount: z.number().int(),
}).nullable();
export type IncidentContext = z.infer<typeof incidentContextSchema>;

export const healPreviewPromptResponseSchema = z.object({
  scraperId: z.string(),
  prompt: z.string().nullable(),
  findings: z.array(checkResultSchema),
  incident: incidentContextSchema,
});
export type HealPreviewPromptResponse = z.infer<typeof healPreviewPromptResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/heal/:scraperId/status
// ---------------------------------------------------------------------------

export const healStatusResponseSchema = z.object({
  scraperId: z.string(),
  status: z.enum(["idle", "running", "pending_answer", "error"]),
  attemptId: z.string().nullable(),
  incidentId: z.string().nullable(),
  step: z.string().nullable(),
  completedSteps: z.array(z.string()),
  startedAt: timestampSchema.nullable(),
  elapsedMs: z.number().nullable(),
  diff: z.lazy(() => healDiffSchema).optional(),
  previewResult: z.array(z.unknown()).nullable(),
  diffSummary: z.string().nullable(),
});
export type HealStatusResponse = z.infer<typeof healStatusResponseSchema>;

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

/** One step of a scraper template (code + optional parse). */
const templateStepSchema = z.record(z.string(), z.unknown());

/** Before/after diff returned by BD's refactor_template/progress. */
export const healDiffSchema = z.object({
  title: z.string(),
  template_a: z.array(templateStepSchema),
  template_b: z.array(templateStepSchema),
}).nullable();
export type HealDiff = z.infer<typeof healDiffSchema>;

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
  diff: healDiffSchema.optional(),
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
