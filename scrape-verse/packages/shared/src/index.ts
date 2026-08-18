import { z } from "zod";

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

/** Evidence bundle handed to the heal orchestrator when a run fails validation. */
export interface IncidentEvidence {
  kind: IncidentKind;
  failedChecks: string[];
  sampleBadRows: unknown[];
  sampleGoodRows: unknown[];
  fieldNullRates: Record<string, number>;
  baselineNullRates: Record<string, number>;
  rowCount: number;
  expectedRowCount: number;
}
