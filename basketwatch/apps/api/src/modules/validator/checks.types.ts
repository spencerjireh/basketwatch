import { type CheckResult, type Verdict } from "@basketwatch/contract";

export type { CheckResult, Verdict };

/**
 * Rolling per-scraper expectations a run is compared against. Stored in the
 * baselines table; kept as a plain interface here so the checks stay pure.
 */
export interface Baseline {
  fieldNullRates: Record<string, number>;
  expectedRowCount: number;
  /** per-field [p5, p95] envelope for numeric fields */
  valueRanges: Record<string, [number, number]>;
}
