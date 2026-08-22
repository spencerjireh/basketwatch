import {
  incidentEvidenceSchema,
  type IncidentEvidence,
  type IncidentKind,
} from "@basketwatch/contract";

/**
 * Evidence is jsonb, so the column promises nothing about its shape.
 *
 * Rows written before the validator existed carry an ad-hoc object -- the one
 * live incident holds `{ rows, reason, covered_by }` -- and rejecting those
 * would blank the audit panel, which is the demo centrepiece. So: parse
 * strictly, and when that fails salvage what is recognisable rather than
 * throwing. An incident with thin evidence is still worth showing.
 */
export function toEvidence(raw: unknown, kind: IncidentKind): IncidentEvidence {
  const parsed = incidentEvidenceSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const loose = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    kind,
    failedChecks: [],
    sampleBadRows: [],
    sampleGoodRows: [],
    fieldNullRates: {},
    baselineNullRates: {},
    rowCount: asCount(loose.rowCount ?? loose.rows),
    expectedRowCount: asCount(loose.expectedRowCount ?? loose.expected_row_count),
  };
}

/**
 * One line naming what went wrong, for the feed and the incident list.
 *
 * The incidents table has no summary column and should not grow one: a summary
 * is a rendering of the evidence, and storing it would let the two drift.
 */
export function summarise(kind: IncidentKind, evidence: IncidentEvidence, raw: unknown): string {
  const reason = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).reason : undefined;
  if (typeof reason === "string" && reason.length > 0) return reason;

  const failed = evidence.failedChecks.map((check) => check.check).join(", ");
  switch (kind) {
    case "rowcount":
      return `Row count ${evidence.rowCount}, expected ${evidence.expectedRowCount}`;
    case "nulls":
      return `Null rate spike on ${Object.keys(evidence.fieldNullRates).join(", ") || "an unnamed field"}`;
    case "schema":
      return "Delivered rows no longer match the output contract";
    case "drift":
      return "Prices moved outside the expected envelope";
    case "freshness":
      return "Expected delivery did not arrive";
    case "studio_failed":
    case "studio_error":
      return "Scraper Studio did not return usable rows";
    case "studio_broken":
      return "Scraper Studio returned rows, but none matched the output contract";
    case "studio_timeout":
      return "Scraper Studio did not finish inside the deadline";
    case "studio_empty":
      return "Scraper Studio ran and returned nothing at all";
    case "sitemap_error":
      return "No URLs to submit: catalogue discovery came back empty";
    case "provisioning_error":
      return "No Studio collector exists for this store yet";
    case "mass_change_suppressed":
      return `Nearly every price moved at once (${evidence.rowCount} rows); the run was recorded but not applied`;
    case "error":
      return failed ? `Run failed: ${failed}` : "Run failed";
    default:
      return failed || "Validation failed";
  }
}

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
