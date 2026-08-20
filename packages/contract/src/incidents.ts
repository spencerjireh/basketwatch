import { z } from "zod";
import { moneySchema, pageQuerySchema, pageSchema, timestampSchema } from "./primitives.js";
import {
  checkResultSchema,
  incidentKindSchema,
  incidentStateSchema,
  healVerdictSchema,
  runStatusSchema,
} from "./vocabulary.js";

/** The bundle handed to the heal orchestrator when a run fails validation. */
export const incidentEvidenceSchema = z.object({
  kind: incidentKindSchema,
  failedChecks: z.array(checkResultSchema),
  sampleBadRows: z.array(z.unknown()),
  sampleGoodRows: z.array(z.unknown()),
  fieldNullRates: z.record(z.string(), z.number()),
  baselineNullRates: z.record(z.string(), z.number()),
  rowCount: z.number().int(),
  expectedRowCount: z.number().int(),
});
export type IncidentEvidence = z.infer<typeof incidentEvidenceSchema>;

/** The verification run fired after Studio saves a healed scraper. */
export const canaryResultSchema = z.object({
  ranAt: timestampSchema,
  rows: z.number().int(),
  nullRatePct: z.number(),
  status: runStatusSchema,
});
export type CanaryResult = z.infer<typeof canaryResultSchema>;

/**
 * One pass of the heal loop. The audit view reads these front to back:
 * diagnosis, prompt, Studio diff, canary, verdict, cost.
 *
 * `attempt`, `startedAt`, `finishedAt` and `canary` have no columns on the
 * heal_attempts table yet -- it carries only created_at. They are in the
 * contract anyway because the audit view is the demo centrepiece, so the gap
 * should surface as a type error when the repository is written rather than as
 * a blank panel on stage. Closing it is item 1 of migration 0001.
 */
export const healAttemptSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  /** 1-based, capped by HEAL_MAX_ATTEMPTS_PER_INCIDENT */
  attempt: z.number().int().positive(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  claudeDiagnosis: z.string(),
  healPrompt: z.string(),
  /** null until Studio returns a proposal */
  studioDiff: z.string().nullable(),
  canary: canaryResultSchema.nullable(),
  /** null while the attempt is still in flight */
  verdict: healVerdictSchema.nullable(),
  creditsSpent: moneySchema,
});
export type HealAttempt = z.infer<typeof healAttemptSchema>;

/**
 * GET /api/incidents, GET /api/incidents/:id
 *
 * Deliberately a fat response: evidence and every attempt travel with the
 * incident so the audit view renders from a single request. The alternative is
 * three round trips to draw one screen.
 */
export const incidentSchema = z.object({
  id: z.string(),
  storeId: z.string().nullable(),
  storeName: z.string(),
  collectorId: z.string().nullable(),
  kind: incidentKindSchema,
  state: incidentStateSchema,
  openedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
  summary: z.string(),
  evidence: incidentEvidenceSchema,
  attempts: z.array(healAttemptSchema),
});
export type Incident = z.infer<typeof incidentSchema>;

export const incidentsQuerySchema = pageQuerySchema.extend({
  state: incidentStateSchema.optional(),
});
export type IncidentsQuery = z.infer<typeof incidentsQuerySchema>;
export const incidentsResponseSchema = pageSchema(incidentSchema);
export type IncidentsResponse = z.infer<typeof incidentsResponseSchema>;
