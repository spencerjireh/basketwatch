import { describe, expect, it } from "vitest";
import { priceRecordSchema } from "@basketwatch/contract";
import { checkDrift, checkNullRates, checkRowCount, checkSchema, validateRun, validateSample } from "./checks.js";
import { type Baseline } from "./checks.types.js";

const parse = (row: unknown) => priceRecordSchema.safeParse(row).success;

const baseline: Baseline = {
  fieldNullRates: { price: 0.02, name: 0.0 },
  expectedRowCount: 10,
  valueRanges: { price: [1, 20] },
};

const goodRow = {
  product_key: "eggs-dozen",
  name: "Eggs, dozen",
  price: 4.29,
  currency: "USD",
  unit: "12 ct",
  in_stock: true,
  url: "https://store.test/eggs",
  observed_at: "2026-08-20T06:00:00.000Z",
};

const rows = (n: number, overrides: Record<string, unknown> = {}) =>
  Array.from({ length: n }, () => ({ ...goodRow, ...overrides }));

describe("checkSchema", () => {
  it("passes a clean run", () => {
    expect(checkSchema(rows(10), parse)).toHaveLength(0);
  });

  it("hard-fails when most rows break the contract", () => {
    const bad = [...rows(2), ...Array.from({ length: 8 }, () => ({ nonsense: true }))];
    expect(checkSchema(bad, parse)[0]?.severity).toBe("hard");
  });

  it("stays soft when only a minority break the contract", () => {
    const bad = [...rows(8), ...Array.from({ length: 2 }, () => ({ nonsense: true }))];
    expect(checkSchema(bad, parse)[0]?.severity).toBe("soft");
  });
});

describe("checkRowCount", () => {
  it("hard-fails a truncated pull", () => {
    expect(checkRowCount(2, baseline)[0]?.severity).toBe("hard");
  });

  it("flags a runaway crawl", () => {
    expect(checkRowCount(100, baseline)[0]?.detail).toContain("runaway");
  });

  it("stays quiet within tolerance", () => {
    expect(checkRowCount(9, baseline)).toHaveLength(0);
  });
});

describe("checkNullRates", () => {
  it("catches the silent half-broken run", () => {
    const half = [...rows(8, { price: null, name: null }), ...rows(2)];
    const findings = checkNullRates(half, baseline);
    expect(findings.some((f) => f.severity === "hard")).toBe(true);
  });

  it("treats an empty run as fully null rather than dividing by zero", () => {
    const findings = checkNullRates([], baseline);
    expect(findings.some((f) => f.severity === "hard")).toBe(true);
  });

  it("stays quiet when null rates match the baseline", () => {
    expect(checkNullRates(rows(10), baseline)).toHaveLength(0);
  });
});

describe("checkDrift", () => {
  it("flags a mass move outside the envelope, softly", () => {
    const findings = checkDrift(rows(10, { price: 400 }), baseline);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("soft");
  });

  it("ignores a minority of outliers", () => {
    expect(checkDrift([...rows(8), ...rows(2, { price: 400 })], baseline)).toHaveLength(0);
  });
});

describe("validateRun", () => {
  it("returns ok on a clean run", () => {
    expect(validateRun(rows(10), parse, baseline).status).toBe("ok");
  });

  it("returns broken when a hard check fires", () => {
    const junk = Array.from({ length: 10 }, () => ({ input: { url: "https://store.test" } }));
    expect(validateRun(junk, parse, baseline).status).toBe("broken");
  });

  it("returns suspect when only soft checks fire", () => {
    expect(validateRun(rows(10, { price: 400 }), parse, baseline).status).toBe("suspect");
  });
});

describe("validateSample", () => {
  // A full-catalogue baseline: expectedRowCount in the hundreds, which is
  // exactly what makes validateRun unusable on a 3-row preview.
  const catalogueBaseline: Baseline = {
    fieldNullRates: { price: 0.02, name: 0.0, size_value: 0.3 },
    expectedRowCount: 250,
    valueRanges: { price: [1, 20] },
  };

  it("passes a healthy 3-row preview that validateRun would call broken", () => {
    expect(validateRun(rows(3), parse, catalogueBaseline).status).toBe("broken");
    expect(validateSample(rows(3), parse, catalogueBaseline).status).toBe("ok");
  });

  it("is broken when the sample is empty", () => {
    expect(validateSample([], parse, catalogueBaseline).status).toBe("broken");
  });

  it("is broken when every price is null", () => {
    const verdict = validateSample(rows(3, { price: null }), parse, catalogueBaseline);
    expect(verdict.status).toBe("broken");
  });

  it("ignores fields other than price and name for null spikes", () => {
    // size_value null in every row: 100% vs 30% baseline would hard-fail
    // validateRun; a 3-row preview must not be judged on it.
    const verdict = validateSample(rows(3, { size_value: null }), parse, catalogueBaseline);
    expect(verdict.findings.filter((f) => f.check === "nulls")).toHaveLength(0);
  });

  it("stays soft on price drift -- a sale is not a broken scraper", () => {
    const verdict = validateSample(rows(3, { price: 400 }), parse, catalogueBaseline);
    expect(verdict.status).toBe("suspect");
  });
});
