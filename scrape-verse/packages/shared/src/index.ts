import { z } from "zod";

export * from "./api.js";

/**
 * The single output contract every Studio scraper in the fleet must emit.
 * Scraper creation prompts instruct the AI to produce exactly these fields;
 * the spider-sense validator enforces it on every delivered run.
 */
export const priceRecordSchema = z.object({
  product_key: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
  currency: z.string().length(3),
  unit: z.string().min(1),
  in_stock: z.boolean(),
  url: z.string().url(),
  observed_at: z.string().datetime(),
});

export type PriceRecord = z.infer<typeof priceRecordSchema>;

/**
 * Country is a first-class dimension (PRD decision 2): stores, products and
 * baskets all carry it, so adding a country's sites enables comparison with
 * no rework. Currency travels as an ISO code alongside it rather than being
 * assumed from the country.
 */
export const countries = ["US", "PH"] as const;

export type Country = (typeof countries)[number];

export const scraperStates = [
  "healthy",
  "suspect",
  "broken",
  "healing",
  "verifying",
  "manual_attention",
] as const;

export type ScraperState = (typeof scraperStates)[number];

export const incidentKinds = [
  "schema",
  "nulls",
  "rowcount",
  "drift",
  "freshness",
  "error",
] as const;

export type IncidentKind = (typeof incidentKinds)[number];

export const incidentStates = ["open", "healing", "resolved", "manual"] as const;

export type IncidentState = (typeof incidentStates)[number];

export const healVerdicts = ["approved", "rejected", "failed"] as const;

export type HealVerdict = (typeof healVerdicts)[number];

/** Rolling per-scraper expectations the validator compares each run against. */
export interface Baseline {
  fieldNullRates: Record<string, number>;
  expectedRowCount: number;
  /** per-field [p5, p95] envelope for numeric fields */
  valueRanges: Record<string, [number, number]>;
}

/**
 * `freshness` is checked by the scheduler rather than the pure row checks, so
 * it appears here but not in the row-level check functions.
 */
export const checkNames = ["schema", "rowcount", "nulls", "drift", "freshness"] as const;

export type CheckName = (typeof checkNames)[number];

export interface CheckResult {
  check: CheckName;
  severity: "hard" | "soft";
  detail: string;
}

export const runStatuses = ["ok", "suspect", "broken"] as const;

export type RunStatus = (typeof runStatuses)[number];

export interface Verdict {
  status: RunStatus;
  findings: CheckResult[];
}

/** Evidence bundle handed to the heal orchestrator when a run fails validation. */
export interface IncidentEvidence {
  kind: IncidentKind;
  failedChecks: CheckResult[];
  sampleBadRows: unknown[];
  sampleGoodRows: unknown[];
  fieldNullRates: Record<string, number>;
  baselineNullRates: Record<string, number>;
  rowCount: number;
  expectedRowCount: number;
}
