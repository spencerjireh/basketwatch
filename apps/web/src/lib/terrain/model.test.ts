import type { Money, Rail, RailPin } from "@basketwatch/contract";
import { describe, expect, it } from "vitest";
import {
  RATIO_CAP,
  WEATHER_GAIN,
  buildTerrainGrid,
  findCell,
  findGap,
  heightFor,
  weatherFor,
} from "@/lib/terrain/model";

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

/** Same shape as the store-totals fixture, so the two models can be compared. */
const rails: Rail[] = [
  rail({
    itemKey: "rice",
    label: "Rice",
    indexQuantity: 5,
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
    pins: [
      pin({ storeId: "alpha", storeName: "Alpha Mart", unitPrice: usd(3) }),
      pin({ storeId: "bravo", storeName: "Bravo Foods", unitPrice: usd(2) }),
    ],
  }),
  rail({
    itemKey: "coffee",
    label: "Coffee",
    pins: [pin({ storeId: "delta", storeName: "Delta Grocer", unitPrice: usd(3) })],
  }),
];

describe("heightFor", () => {
  it("puts the cheapest shelf on the floor and the cap at the ceiling", () => {
    expect(heightFor(1)).toBe(0);
    expect(heightFor(RATIO_CAP)).toBe(1);
    expect(heightFor(RATIO_CAP * 4)).toBe(1);
  });

  it("is log-scaled between the two", () => {
    expect(heightFor(Math.sqrt(RATIO_CAP))).toBeCloseTo(0.5);
  });

  it("never digs below the floor", () => {
    expect(heightFor(0.5)).toBe(0);
  });
});

describe("weatherFor", () => {
  it("reads the excluded fraction over the gain", () => {
    // rice carries one suspect pin out of seven US pins total.
    expect(weatherFor(rails, "US")).toBeCloseTo(1 / 7 / WEATHER_GAIN);
  });

  it("saturates at full overcast", () => {
    const broken = [
      rail({
        itemKey: "rice",
        label: "Rice",
        pins: [
          pin({ storeId: "a", storeName: "A", flag: "suspect", flagReason: "x" }),
          pin({ storeId: "b", storeName: "B", unitPrice: null }),
        ],
      }),
    ];
    expect(weatherFor(broken, "US")).toBe(1);
  });

  it("is clear when there is nothing to measure", () => {
    expect(weatherFor([], "US")).toBe(0);
  });
});

describe("buildTerrainGrid", () => {
  const grid = buildTerrainGrid(rails, "US");

  it("orders columns by the basket ranking, unmeasured stores last", () => {
    expect(grid?.stores.map((store) => store.storeId)).toEqual([
      "costless",
      "alpha",
      "bravo",
      "delta",
    ]);
  });

  it("keeps one row per rail, in rail order", () => {
    expect(grid?.staples.map((staple) => staple.itemKey)).toEqual(["rice", "eggs", "coffee"]);
  });

  it("measures each cell against the cheapest shelf on its own row", () => {
    // rice row: cheapest usable shelf is costless at 0.50, suspect pin dropped.
    const rice = grid?.cells[0];
    expect(rice?.map((cell) => cell?.ratio ?? null)).toEqual([1, 2, 4, null]);
    // eggs row: bravo's 2.00 is the floor.
    const eggs = grid?.cells[1];
    expect(eggs?.map((cell) => cell?.ratio ?? null)).toEqual([null, 1.5, 1, null]);
    expect(grid?.maxRatio).toBe(4);
  });

  it("derives height from the ratio", () => {
    const alphaRice = grid?.cells[0]?.[1];
    expect(alphaRice?.height).toBeCloseTo(heightFor(2));
    expect(alphaRice?.capped).toBe(false);
  });

  it("caps an outlier's height but keeps its true ratio", () => {
    const outlier = [
      rail({
        itemKey: "rice",
        label: "Rice",
        pins: [
          pin({ storeId: "a", storeName: "A", unitPrice: usd(1) }),
          pin({ storeId: "b", storeName: "B", unitPrice: usd(10) }),
        ],
      }),
      rail({
        itemKey: "eggs",
        label: "Eggs",
        pins: [
          pin({ storeId: "a", storeName: "A", unitPrice: usd(1) }),
          pin({ storeId: "b", storeName: "B", unitPrice: usd(1) }),
        ],
      }),
    ];
    const capped = buildTerrainGrid(outlier, "US");
    const cell = capped?.cells[0]?.find((candidate) => candidate?.storeId === "b");
    expect(cell?.ratio).toBe(10);
    expect(cell?.height).toBe(1);
    expect(cell?.capped).toBe(true);
    expect(capped?.maxRatio).toBe(10);
  });

  it("declines to draw a degenerate landscape", () => {
    expect(buildTerrainGrid([], "US")).toBeNull();
    // One store is a bar chart, not a landscape.
    const solo = [
      rail({
        itemKey: "rice",
        label: "Rice",
        pins: [pin({ storeId: "a", storeName: "A", unitPrice: usd(1) })],
      }),
      rail({
        itemKey: "eggs",
        label: "Eggs",
        pins: [pin({ storeId: "a", storeName: "A", unitPrice: usd(1) })],
      }),
    ];
    expect(buildTerrainGrid(solo, "US")).toBeNull();
  });
});

describe("findCell and findGap", () => {
  const grid = buildTerrainGrid(rails, "US");
  if (!grid) throw new Error("fixture grid did not build");

  it("finds a cell by country, staple, and store", () => {
    const cell = findCell(grid, { country: "US", itemKey: "rice", storeId: "alpha" });
    expect(cell?.ratio).toBe(2);
    expect(findCell(grid, { country: "PH", itemKey: "rice", storeId: "alpha" })).toBeNull();
    expect(findCell(grid, { country: "US", itemKey: "rice", storeId: "nowhere" })).toBeNull();
  });

  it("names a gap where a store and staple cross with nothing there", () => {
    expect(findGap(grid, { country: "US", itemKey: "rice", storeId: "delta" })).toEqual({
      storeName: "Delta Grocer",
      label: "Rice",
    });
    // An occupied cell is not a gap.
    expect(findGap(grid, { country: "US", itemKey: "rice", storeId: "alpha" })).toBeNull();
  });
});
