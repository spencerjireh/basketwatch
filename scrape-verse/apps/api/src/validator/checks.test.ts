import { describe, expect, it } from "vitest";
import { priceRecordSchema } from "@scrape-verse/shared";
import { checkNullRates, checkRowCount, validateRun, type Baseline } from "./checks.js";

const baseline: Baseline = {
  fieldNullRates: { price: 0.02, name: 0.0 },
  expectedRowCount: 10,
  valueRanges: { price: [1, 20] },
};

const goodRow = {
  product_key: "eggs-12",
  name: "Eggs 12ct",
  price: 4.5,
  currency: "USD",
  unit: "dozen",
  in_stock: true,
  url: "https://store.test/eggs",
  observed_at: new Date("2026-08-17T00:00:00Z").toISOString(),
};

describe("checkNullRates", () => {
  it("flags the silent half-broken run (the HN probe failure mode)", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => ({ ...goodRow, price: null, name: null })),
      goodRow,
      goodRow,
    ];
    const findings = checkNullRates(rows as Record<string, unknown>[], baseline);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.severity === "hard")).toBe(true);
  });

  it("stays quiet when null rates match baseline", () => {
    const rows = Array.from({ length: 10 }, () => goodRow);
    expect(checkNullRates(rows as Record<string, unknown>[], baseline)).toHaveLength(0);
  });
});

describe("checkRowCount", () => {
  it("hard-fails a near-empty run", () => {
    expect(checkRowCount(2, baseline)[0]?.severity).toBe("hard");
  });
  it("flags a runaway crawl softly", () => {
    expect(checkRowCount(100, baseline)[0]?.detail).toContain("runaway");
  });
  it("accepts normal counts", () => {
    expect(checkRowCount(9, baseline)).toHaveLength(0);
  });
});

describe("validateRun", () => {
  it("returns ok for a clean run", () => {
    const rows = Array.from({ length: 10 }, () => goodRow);
    expect(validateRun(rows as Record<string, unknown>[], priceRecordSchema, baseline).status).toBe("ok");
  });

  it("returns broken when most rows are empty", () => {
    const rows = Array.from({ length: 10 }, () => ({ input: { url: "https://store.test" } }));
    expect(validateRun(rows as Record<string, unknown>[], priceRecordSchema, baseline).status).toBe("broken");
  });
});
