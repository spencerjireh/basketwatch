import { type Baseline, type CheckResult, type Verdict } from "./checks.types.js";

/**
 * Spider-sense: pure anomaly checks over a delivered run.
 *
 * No IO in this file. Everything takes data in and returns findings, which is
 * what makes the layer unit-testable and lets a stored raw_output be replayed
 * against new rules months later. The impure edge -- loading a baseline,
 * opening an incident -- lives in validator.service.ts.
 */

/** Hard fail: rows that do not match the fleet output contract. */
export function checkSchema(rows: unknown[], parse: (row: unknown) => boolean): CheckResult[] {
  const bad = rows.filter((row) => !parse(row));
  if (bad.length === 0) return [];
  return [
    {
      check: "schema",
      severity: bad.length / rows.length > 0.5 ? "hard" : "soft",
      detail: `${bad.length}/${rows.length} rows fail the output contract`,
    },
  ];
}

/**
 * Row count against the rolling baseline.
 *
 * The runaway branch is not symmetry for its own sake: an unbounded crawl once
 * produced thousands of unintended rows, and "too much data" is as much a
 * breakage signal as "too little".
 */
export function checkRowCount(rowCount: number, baseline: Baseline): CheckResult[] {
  const expected = baseline.expectedRowCount;
  if (expected <= 0) return [];
  const ratio = rowCount / expected;

  if (ratio < 0.4) {
    return [
      { check: "rowcount", severity: "hard", detail: `got ${rowCount}, expected ~${expected}` },
    ];
  }
  if (ratio < 0.7) {
    return [
      { check: "rowcount", severity: "soft", detail: `got ${rowCount}, expected ~${expected}` },
    ];
  }
  if (ratio > 3) {
    return [
      {
        check: "rowcount",
        severity: "soft",
        detail: `got ${rowCount}, ${ratio.toFixed(1)}x expected -- runaway crawl?`,
      },
    ];
  }
  return [];
}

/**
 * Null-rate spike per field. This is the silent killer: the run succeeds, the
 * row count looks fine, and every price is null because a selector moved.
 */
export function checkNullRates(
  rows: Record<string, unknown>[],
  baseline: Baseline,
  spikeThreshold = 0.25,
): CheckResult[] {
  const findings: CheckResult[] = [];

  for (const [field, baseRate] of Object.entries(baseline.fieldNullRates)) {
    const nulls = rows.filter((row) => {
      const value = row[field];
      return value === null || value === undefined || value === "";
    }).length;

    // An empty run is a 100% null rate, not a division by zero.
    const rate = rows.length === 0 ? 1 : nulls / rows.length;
    if (rate - baseRate <= spikeThreshold) continue;

    findings.push({
      check: "nulls",
      severity: rate > 0.6 ? "hard" : "soft",
      detail: `${field}: null-rate ${(rate * 100).toFixed(0)}% vs baseline ${(baseRate * 100).toFixed(0)}%`,
    });
  }

  return findings;
}

/**
 * Value drift against the baseline p5-p95 envelope.
 *
 * Soft only, always. Prices genuinely move, and a hard fail here would open an
 * incident every time a store ran a sale.
 */
export function checkDrift(
  rows: Record<string, unknown>[],
  baseline: Baseline,
  outlierShareThreshold = 0.5,
): CheckResult[] {
  const findings: CheckResult[] = [];

  for (const [field, range] of Object.entries(baseline.valueRanges)) {
    const [p5, p95] = range;
    const values = rows
      .map((row) => row[field])
      .filter((value): value is number => typeof value === "number");

    if (values.length === 0) continue;

    const outliers = values.filter((value) => value < p5 || value > p95).length;
    const share = outliers / values.length;
    if (share <= outlierShareThreshold) continue;

    findings.push({
      check: "drift",
      severity: "soft",
      detail: `${field}: ${(share * 100).toFixed(0)}% of values outside [${p5}, ${p95}]`,
    });
  }

  return findings;
}

/** Combine every check into the verdict that drives the state machine. */
export function validateRun(
  rows: Record<string, unknown>[],
  parse: (row: unknown) => boolean,
  baseline: Baseline,
): Verdict {
  const findings = [
    ...checkSchema(rows, parse),
    ...checkRowCount(rows.length, baseline),
    ...checkNullRates(rows, baseline),
    ...checkDrift(rows, baseline),
  ];

  if (findings.some((finding) => finding.severity === "hard")) {
    return { status: "broken", findings };
  }
  if (findings.length > 0) return { status: "suspect", findings };
  return { status: "ok", findings };
}

/**
 * Judge a SMALL sample -- a heal proposal's preview rows -- against the same
 * baseline. validateRun cannot do this: checkRowCount hard-fails any sample
 * against a full-catalogue expectedRowCount, and per-field null rates are
 * noise at n<=5 (one missing size in three rows is a 33% "spike").
 *
 * So: schema as-is (that IS the question a heal answers), nulls only for the
 * fields a heal must fix (price, name) and hard only when the sample is
 * mostly null AND clearly worse than baseline, drift as-is (soft only), and
 * no row count. An empty sample is broken -- a healed template that previews
 * nothing fixed nothing.
 */
export function validateSample(
  rows: Record<string, unknown>[],
  parse: (row: unknown) => boolean,
  baseline: Baseline,
): Verdict {
  if (rows.length === 0) {
    return {
      status: "broken",
      findings: [
        { check: "rowcount", severity: "hard", detail: "preview sample contains no usable rows" },
      ],
    };
  }

  const sampleBaseline: Baseline = {
    ...baseline,
    fieldNullRates: Object.fromEntries(
      Object.entries(baseline.fieldNullRates).filter(
        ([field]) => field === "price" || field === "name",
      ),
    ),
  };

  // checkNullRates is already the relaxed rule we want: it only speaks when
  // the sample is 25 points worse than baseline, and only hard above 60%.
  const findings = [
    ...checkSchema(rows, parse),
    ...checkNullRates(rows, sampleBaseline),
    ...checkDrift(rows, baseline),
  ];

  if (findings.some((finding) => finding.severity === "hard")) {
    return { status: "broken", findings };
  }
  if (findings.length > 0) return { status: "suspect", findings };
  return { status: "ok", findings };
}
