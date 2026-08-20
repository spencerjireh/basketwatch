import { z } from "zod";

/**
 * The shared vocabulary: const array plus derived type, never a TS enum, so the
 * same list drives runtime validation and the UI's exhaustiveness checks.
 */

/** The scraper state machine (architecture.md section 3.2). */
export const scraperStates = [
  "healthy",
  "suspect",
  "broken",
  "healing",
  "verifying",
  "manual_attention",
] as const;
export const scraperStateSchema = z.enum(scraperStates);
export type ScraperState = z.infer<typeof scraperStateSchema>;

/**
 * A run's verdict, in the validator's vocabulary.
 *
 * The `runs.status` column in Postgres holds an older vocabulary --
 * ok|anomalous|error -- across 19 live rows. This one wins because it matches
 * both scraperStates and the validator verdict. The column is plain text with
 * no CHECK constraint, so nothing needs migrating today; database/mappers
 * translates on read until migration 0001 normalises the rows.
 */
export const runStatuses = ["ok", "suspect", "broken"] as const;
export const runStatusSchema = z.enum(runStatuses);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const incidentKinds = [
  "schema",
  "nulls",
  "rowcount",
  "drift",
  "freshness",
  "error",
  /** a Studio collector failed and the direct puller covered for it */
  "studio_failed",
  /** over 90% of an established catalogue changed at once; history left alone */
  "mass_change_suppressed",
] as const;
export const incidentKindSchema = z.enum(incidentKinds);
export type IncidentKind = z.infer<typeof incidentKindSchema>;

export const incidentStates = ["open", "healing", "resolved", "manual"] as const;
export const incidentStateSchema = z.enum(incidentStates);
export type IncidentState = z.infer<typeof incidentStateSchema>;

export const healVerdicts = ["approved", "rejected", "failed"] as const;
export const healVerdictSchema = z.enum(healVerdicts);
export type HealVerdict = z.infer<typeof healVerdictSchema>;

/**
 * `freshness` is checked by the scheduler, not by the pure row checks, so it is
 * a valid check name with no row-level implementation.
 */
export const checkNames = ["schema", "rowcount", "nulls", "drift", "freshness"] as const;
export const checkNameSchema = z.enum(checkNames);
export type CheckName = z.infer<typeof checkNameSchema>;

export const checkResultSchema = z.object({
  check: checkNameSchema,
  severity: z.enum(["hard", "soft"]),
  detail: z.string(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const verdictSchema = z.object({
  status: runStatusSchema,
  findings: z.array(checkResultSchema),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** How a row reached us. Recorded per observation, not per run. */
export const dataSources = ["studio", "puller", "manual"] as const;
export const dataSourceSchema = z.enum(dataSources);
export type DataSource = z.infer<typeof dataSourceSchema>;
