import type { Money, Rail, RailPin } from "@basketwatch/contract";
import { describe, expect, it } from "vitest";
import { basketSpread, rankStores, storeOrder } from "@/lib/basket/store-totals";

const usd = (amount: number): Money => ({ amount, currency: "USD" });

function pin(overrides: Partial<RailPin> & Pick<RailPin, "storeId" | "storeName">): RailPin {
  return {
    indexContributor: true,
    productKey: `${overrides.storeId}-sku`,
    productName: "Some product",
    price: null,
    unitPrice: null,
    unitPriceBasis: "per_kg",
    flag: "ok",
    flagReason: null,
    cheapest: false,
    dearest: false,
    ...overrides,
  };
}

function rail(overrides: Partial<Rail> & Pick<Rail, "itemKey" | "label">): Rail {
  return {
    country: "US",
    currency: "USD",
    indexQuantity: null,
    indexUom: null,
    medianUnitPrice: null,
    comparable: true,
    pins: [],
    ...overrides,
  };
}

/**
 * The worked example the assertions below are computed from, by hand:
 *
 * rice (5 kg): alpha 1.00, bravo 2.00, costless 0.50 (not an index
 * contributor), sus 0.10 (suspect). Cheapest countable shelf is alpha's 1.00.
 * eggs (12 count): alpha 3.00, bravo 2.00. Cheapest countable is bravo's 2.00.
 * coffee: delta 3.00, but the rail carries no index quantity.
 * One PH rail, to prove the country filter.
 */
const rails: Rail[] = [
  rail({
    itemKey: "rice",
    label: "Rice",
    indexQuantity: 5,
    indexUom: "kg",
    pins: [
      pin({ storeId: "alpha", storeName: "Alpha Mart", unitPrice: usd(1) }),
      pin({ storeId: "bravo", storeName: "Bravo Foods", unitPrice: usd(2) }),
      pin({
        storeId: "costless",
        storeName: "Costless",
        indexContributor: false,
        unitPrice: usd(0.5),
      }),
      pin({
        storeId: "sus",
        storeName: "Sus Depot",
        flag: "suspect",
        flagReason: "wholesale case price",
        unitPrice: usd(0.1),
      }),
    ],
  }),
  rail({
    itemKey: "eggs",
    label: "Eggs",
    indexQuantity: 12,
    indexUom: "count",
    pins: [
      pin({
        storeId: "alpha",
        storeName: "Alpha Mart",
        unitPrice: usd(3),
        unitPriceBasis: "per_item",
      }),
      pin({
        storeId: "bravo",
        storeName: "Bravo Foods",
        unitPrice: usd(2),
        unitPriceBasis: "per_item",
      }),
    ],
  }),
  rail({
    itemKey: "coffee",
    label: "Coffee",
    pins: [pin({ storeId: "delta", storeName: "Delta Grocer", unitPrice: usd(3) })],
  }),
  rail({
    itemKey: "rice",
    label: "Rice",
    country: "PH",
    currency: "PHP",
    indexQuantity: 5,
    pins: [
      pin({
        storeId: "ph-store",
        storeName: "PH Store",
        unitPrice: { amount: 60, currency: "PHP" },
      }),
    ],
  }),
];

describe("rankStores", () => {
  const ranking = rankStores(rails, "US");

  it("counts only the rails a store could have covered", () => {
    expect(ranking.priceable).toBe(2);
  });

  it("ranks by mean ratio against the cheapest countable shelf", () => {
    expect(ranking.ranked.map((store) => store.storeId)).toEqual(["alpha", "bravo"]);

    const [alpha, bravo] = ranking.ranked;
    expect(alpha?.total).toBe(41); // 1.00 * 5 + 3.00 * 12
    expect(alpha?.meanRatio).toBe(1.25); // (1.0 + 1.5) / 2
    expect(alpha?.covered).toBe(2);
    expect(alpha?.complete).toBe(true);
    expect(alpha?.staples.map((staple) => staple.ratio)).toEqual([1, 1.5]);

    expect(bravo?.total).toBe(34); // 2.00 * 5 + 2.00 * 12
    expect(bravo?.meanRatio).toBe(1.5);
    expect(bravo?.complete).toBe(true);
  });

  it("ranks by ratio even when the raw totals disagree", () => {
    // Bravo's basket is cheaper in absolute money, yet alpha ranks first:
    // the ratio is measured staple by staple, so a store cannot buy rank by
    // pricing only what happens to be cheap.
    const [alpha, bravo] = ranking.ranked;
    expect(alpha!.total).toBeGreaterThan(bravo!.total);
  });

  it("names the stores it cannot rank, with the right reason", () => {
    expect(ranking.ignored).toEqual([
      {
        storeId: "costless",
        storeName: "Costless",
        reason: "not counted by the index",
        meanRatio: 0.5, // 0.50 over alpha's countable 1.00
      },
      {
        storeId: "delta",
        storeName: "Delta Grocer",
        reason: "no comparable price",
        meanRatio: null,
      },
    ]);
  });

  it("drops suspect pins entirely, ranked and ignored alike", () => {
    const everywhere = [...ranking.ranked, ...ranking.ignored].map((store) => store.storeId);
    expect(everywhere).not.toContain("sus");
  });

  it("filters by country and keeps that country's currency", () => {
    const ph = rankStores(rails, "PH");
    expect(ph.currency).toBe("PHP");
    expect(ph.ranked.map((store) => store.storeId)).toEqual(["ph-store"]);
    expect(ph.priceable).toBe(1);
  });

  it("falls back to the country's default currency with no rails at all", () => {
    const empty = rankStores([], "US");
    expect(empty.currency).toBe("USD");
    expect(empty.ranked).toEqual([]);
    expect(empty.ignored).toEqual([]);
  });
});

describe("storeOrder", () => {
  it("interleaves ranked and ignored by ratio, unmeasured stores last", () => {
    expect(storeOrder(rankStores(rails, "US"))).toEqual(["costless", "alpha", "bravo", "delta"]);
  });
});

describe("basketSpread", () => {
  it("spans the complete baskets only", () => {
    const spread = basketSpread(rankStores(rails, "US"));
    expect(spread?.low).toBe(34);
    expect(spread?.high).toBe(41);
    expect(spread?.currency).toBe("USD");
  });

  it("drops the sentence below two complete baskets", () => {
    expect(basketSpread(rankStores(rails, "PH"))).toBeNull();
    expect(basketSpread(rankStores([], "US"))).toBeNull();
  });
});
