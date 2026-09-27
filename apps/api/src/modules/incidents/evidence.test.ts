import { describe, expect, it } from "vitest";
import { summarise, toEvidence } from "./evidence.js";

const full = {
  kind: "rowcount" as const,
  failedChecks: [{ check: "rowcount" as const, severity: "hard" as const, detail: "0 of 2641" }],
  sampleBadRows: [],
  sampleGoodRows: [],
  fieldNullRates: { price: 0.6 },
  baselineNullRates: { price: 0.02 },
  rowCount: 0,
  expectedRowCount: 2641,
};

describe("toEvidence", () => {
  it("passes a well-formed bundle through untouched", () => {
    expect(toEvidence(full, "rowcount")).toEqual(full);
  });

  it("salvages the ad-hoc shape written before the validator existed", () => {
    // The one live incident: { rows, reason, covered_by }.
    const salvaged = toEvidence(
      { rows: 250, reason: "no verified collector for this store", covered_by: "puller" },
      "studio_failed",
    );
    expect(salvaged.rowCount).toBe(250);
    expect(salvaged.kind).toBe("studio_failed");
    expect(salvaged.failedChecks).toEqual([]);
  });

  it.each([null, undefined, "a string", 42, []])("survives %s", (raw) => {
    expect(toEvidence(raw, "error").rowCount).toBe(0);
  });
});

describe("summarise", () => {
  it("prefers a reason the writer supplied", () => {
    const raw = { reason: "no verified collector for this store" };
    expect(summarise("studio_failed", toEvidence(raw, "studio_failed"), raw)).toBe(
      "no verified collector for this store",
    );
  });

  it("names the counts for a row-count incident", () => {
    expect(summarise("rowcount", full, full)).toBe("Row count 0, expected 2641");
  });

  it("always returns something renderable", () => {
    expect(summarise("drift", toEvidence(null, "drift"), null)).not.toBe("");
  });
});
