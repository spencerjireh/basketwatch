import type { Baseline, CheckResult, Verdict } from "@scrape-verse/shared";
import { z } from "zod";

/**
 * Spider-sense: pure anomaly checks over a delivered run.
 * No IO here — everything takes data in and returns findings, so the whole
 * layer is unit-testable and incidents can be replayed against new rules.
 *
 * The Baseline/CheckResult/Verdict vocabulary lives in @scrape-verse/shared
 * because incident evidence and the dashboard audit view speak it too.
 */

export type { Baseline, CheckResult, Verdict };

/** Hard fail: any row that does not match the fleet output contract. */
export function checkSchema(rows: unknown[], schema: z.ZodTypeAny): CheckResult[] {
  const bad = rows.filter((row) => !schema.safeParse(row).success);
  if (bad.length === 0) return [];
  return [
    {
      check: "schema",
      severity: bad.length / rows.length > 0.5 ? "hard" : "soft",
      detail: `${bad.length}/${rows.length} rows fail the output contract`,
    },
  ];
}

/** Hard fail under 40% of expected; soft when 40-70%. Also flags runaway crawls. */
export function checkRowCount(rowCount: number, baseline: Baseline): CheckResult[] {
  const ratio = rowCount / baseline.expectedRowCount;
  if (ratio < 0.4) {
    return [{ check: "rowcount", severity: "hard", detail: `got ${rowCount}, expected ~${baseline.expectedRowCount}` }];
  }
  if (ratio < 0.7) {
    return [{ check: "rowcount", severity: "soft", detail: `got ${rowCount}, expected ~${baseline.expectedRowCount}` }];
  }
  // Lesson from the HN probe: an unbounded crawl is an anomaly too.
  if (ratio > 3) {
    return [{ check: "rowcount", severity: "soft", detail: `got ${rowCount}, ${ratio.toFixed(1)}x expected — runaway crawl?` }];
  }
  return [];
}

/** Null-rate spike per field vs rolling baseline (the silent killer). */
export function checkNullRates(
  rows: Record<string, unknown>[],
  baseline: Baseline,
  spikeThreshold = 0.25,
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const [field, baseRate] of Object.entries(baseline.fieldNullRates)) {
    const nulls = rows.filter((r) => r[field] === null || r[field] === undefined || r[field] === "").length;
    const rate = rows.length === 0 ? 1 : nulls / rows.length;
    if (rate - baseRate > spikeThreshold) {
      results.push({
        check: "nulls",
        severity: rate > 0.6 ? "hard" : "soft",
        detail: `${field}: null-rate ${(rate * 100).toFixed(0)}% vs baseline ${(baseRate * 100).toFixed(0)}%`,
      });
    }
  }
  return results;
}

/** Value drift: numeric fields falling outside the baseline p5-p95 envelope. */
export function checkDrift(
  rows: Record<string, unknown>[],
  baseline: Baseline,
  outlierShareThreshold = 0.5,
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const [field, [p5, p95]] of Object.entries(baseline.valueRanges)) {
    const values = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) continue;
    const outliers = values.filter((v) => v < p5 || v > p95).length;
    const share = outliers / values.length;
    if (share > outlierShareThreshold) {
      results.push({
        check: "drift",
        severity: "soft",
        detail: `${field}: ${(share * 100).toFixed(0)}% of values outside [${p5}, ${p95}]`,
      });
    }
  }
  return results;
}

/** Combine all checks into a run verdict feeding the scraper state machine. */
export function validateRun(
  rows: Record<string, unknown>[],
  schema: z.ZodTypeAny,
  baseline: Baseline,
): Verdict {
  const findings = [
    ...checkSchema(rows, schema),
    ...checkRowCount(rows.length, baseline),
    ...checkNullRates(rows, baseline),
    ...checkDrift(rows, baseline),
  ];
  if (findings.some((f) => f.severity === "hard")) return { status: "broken", findings };
  if (findings.length > 0) return { status: "suspect", findings };
  return { status: "ok", findings };
}
