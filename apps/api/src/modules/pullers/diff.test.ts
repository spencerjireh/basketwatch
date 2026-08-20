import { describe, expect, it } from "vitest";
import { dedupe, diff, isMassChange } from "./diff.js";
import { type PulledRow } from "./puller.types.js";

const row = (productKey: string, price: number): PulledRow => ({
  storeId: "us-mexmax",
  productKey,
  name: `Product ${productKey}`,
  price,
  currency: "USD",
  url: null,
  inStock: true,
  category: null,
  observedAt: "2026-08-20T06:00:00Z",
  size: null,
  unitPrice: null,
  source: "puller",
});

describe("diff", () => {
  it("marks an unseen product new, with no previous price", () => {
    const [change] = diff(new Map(), [row("eggs", 4.29)]);
    expect(change).toMatchObject({ change: "new", previousPrice: null, delta: null });
  });

  it("emits nothing when the price has not moved", () => {
    expect(diff(new Map([["eggs", 4.29]]), [row("eggs", 4.29)])).toEqual([]);
  });

  it("records the move and its delta", () => {
    const [change] = diff(new Map([["eggs", 4.29]]), [row("eggs", 4.99)]);
    expect(change).toMatchObject({ change: "price", previousPrice: 4.29, delta: 0.7 });
  });

  it("records a fall as a negative delta", () => {
    expect(diff(new Map([["eggs", 4.99]]), [row("eggs", 4.29)])[0]?.delta).toBe(-0.7);
  });

  it("ignores float noise below the epsilon", () => {
    expect(diff(new Map([["eggs", 0.1 + 0.2]]), [row("eggs", 0.3)])).toEqual([]);
  });
});

describe("dedupe", () => {
  it("keeps the first row when a paginated API repeats a product", () => {
    const kept = dedupe([row("eggs", 4.29), row("eggs", 9.99), row("milk", 3.5)]);
    expect(kept.map((r) => [r.productKey, r.price])).toEqual([
      ["eggs", 4.29],
      ["milk", 3.5],
    ]);
  });
});

describe("isMassChange", () => {
  it("suppresses a near-total repricing of an established catalogue", () => {
    expect(isMassChange(2641, 2600, true)).toBe(true);
  });

  it("allows a store's first pull, where every price is new by definition", () => {
    expect(isMassChange(2641, 2641, false)).toBe(false);
  });

  it("allows a small catalogue to move wholesale", () => {
    // 100 rows or fewer is a plausible genuine repricing, not a key-scheme change.
    expect(isMassChange(80, 80, true)).toBe(false);
  });

  it("allows an ordinary day", () => {
    expect(isMassChange(2641, 30, true)).toBe(false);
  });
});
