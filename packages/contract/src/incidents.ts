import { z } from "zod";
import { pageQuerySchema, pageSchema, timestampSchema } from "./primitives.js";
import { checkResultSchema, incidentKindSchema, incidentStateSchema } from "./vocabulary.js";

/** What the validator recorded when a run failed: enough to replay the verdict. */
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

/**
 * GET /api/incidents, GET /api/incidents/:id
 *
 * Evidence travels with the incident so one request draws the whole record.
 */
export const incidentSchema = z.object({
  id: z.string(),
  storeId: z.string().nullable(),
  storeName: z.string(),
  kind: incidentKindSchema,
  state: incidentStateSchema,
  openedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
  summary: z.string(),
  evidence: incidentEvidenceSchema,
});
export type Incident = z.infer<typeof incidentSchema>;

export const incidentsQuerySchema = pageQuerySchema.extend({
  state: incidentStateSchema.optional(),
});
export type IncidentsQuery = z.infer<typeof incidentsQuerySchema>;
export const incidentsResponseSchema = pageSchema(incidentSchema);
export type IncidentsResponse = z.infer<typeof incidentsResponseSchema>;
