import {
  DEFAULT_CURRENCY_BY_COUNTRY,
  type Country,
  type Money,
  type Rail,
} from "@basketwatch/contract";
import { rankStores, storeOrder } from "@/lib/basket/store-totals";

/**
 * The terrain model: one grid per country, rows are staples, columns are
 * stores, and a cell's height is how many times the cheapest that store
 * prices that staple.
 *
 * This module is pure math with no React and no three.js in it, because two
 * renderers draw it -- the 3D relief and the SVG ridgeline -- and they must
 * never disagree about what the landscape says.
 */

export type TerrainCell = {
  itemKey: string;
  label: string;
  storeId: string;
  storeName: string;
  productName: string;
  unitPrice: Money;
  unitPriceBasis: string | null;
  /** unit price over the cheapest unit price for this staple; always >= 1 */
  ratio: number;
  /** 0..1, log-scaled and capped so one 9x outlier cannot flatten the relief */
  height: number;
  capped: boolean;
  cheapest: boolean;
  flag: "ok" | "imprecise";
};

export type CellRef = { country: Country; itemKey: string; storeId: string };

export type TerrainGrid = {
  country: Country;
  currency: string;
  staples: { itemKey: string; label: string }[];
  stores: { storeId: string; storeName: string }[];
  /** cells[stapleIdx][storeIdx]; null is a gap -- no pin, no price, or suspect */
  cells: (TerrainCell | null)[][];
  maxRatio: number;
};

export const RATIO_CAP = 8;

export function heightFor(ratio: number): number {
  return Math.min(1, Math.log(Math.max(1, ratio)) / Math.log(RATIO_CAP));
}

/**
 * Raw unhealthy fraction at which the weather saturates to full overcast.
 * Some gaps are structural (a pin observed by nobody yet still counts), so
 * the gain keeps a healthy basket's floor faint while a genuinely broken
 * fleet pins the sky.
 */
export const WEATHER_GAIN = 0.35;

/**
 * The weather over the landscape, 0 clear to 1 overcast: the fraction of
 * pins the terrain had to leave out -- suspect, or carrying no unit price.
 * Computed from the rails rather than the grid because the grid drops those
 * pins before it exists.
 */
export function weatherFor(rails: Rail[], country: Country): number {
  let total = 0;
  let unhealthy = 0;
  for (const rail of rails) {
    if (rail.country !== country) continue;
    for (const pin of rail.pins) {
      total += 1;
      if (pin.flag === "suspect" || pin.unitPrice === null) unhealthy += 1;
    }
  }
  if (total === 0) return 0;
  return Math.min(1, unhealthy / total / WEATHER_GAIN);
}

/**
 * A pin becomes a cell only if it would be drawn on the staple strip too:
 * not suspect, and carrying a unit price. Same filter, same truth -- the
 * terrain can never show a pin the quality worklist excluded.
 */
export function buildTerrainGrid(rails: Rail[], country: Country): TerrainGrid | null {
  const countryRails = rails.filter((rail) => rail.country === country);
  if (countryRails.length === 0) return null;

  type Usable = { rail: Rail; pins: Map<string, Rail["pins"][number]> };
  const usable: Usable[] = countryRails.map((rail) => ({
    rail,
    pins: new Map(
      rail.pins
        .filter((pin) => pin.flag !== "suspect" && pin.unitPrice !== null)
        .map((pin) => [pin.storeId, pin]),
    ),
  }));

  const storeNames = new Map<string, string>();
  for (const { pins } of usable) {
    for (const pin of pins.values()) storeNames.set(pin.storeId, pin.storeName);
  }

  const minByRail = new Map<Rail, number>();
  for (const { rail, pins } of usable) {
    if (pins.size === 0) continue;
    minByRail.set(
      rail,
      Math.min(...[...pins.values()].map((pin) => pin.unitPrice?.amount ?? Infinity)),
    );
  }

  // Column order: cheapest basket on the left. The order is not computed here
  // -- it is the basket ranking, the same one the bars under the hero are drawn
  // from and the same one the headline names two stores out of. One place
  // decides which store is cheapest, or the page contradicts itself in three
  // fonts.
  //
  // Left to right is the basket getting dearer, which is not the same as the
  // ridges getting taller. A cell's height is measured against the cheapest
  // shelf on its row -- every shelf, including the stores the index does not
  // count -- because that is the pin the green dot is on, and the cheapest
  // shelf has to be the floor of the row it is the cheapest in. The ranking
  // measures against the counted shelves only. So a row can dip under a
  // dearer store, and the landscape still slopes the way the bars say.
  const ranking = rankStores(rails, country);
  const rank = new Map(storeOrder(ranking).map((storeId, index) => [storeId, index]));
  const stores = [...storeNames.entries()]
    .map(([storeId, storeName]) => ({ storeId, storeName }))
    .sort(
      (a, b) =>
        (rank.get(a.storeId) ?? Infinity) - (rank.get(b.storeId) ?? Infinity) ||
        a.storeName.localeCompare(b.storeName),
    );

  let maxRatio = 1;
  const staples: TerrainGrid["staples"] = [];
  const cells: (TerrainCell | null)[][] = [];

  for (const { rail, pins } of usable) {
    const min = minByRail.get(rail);
    staples.push({ itemKey: rail.itemKey, label: rail.label });
    cells.push(
      stores.map(({ storeId }) => {
        const pin = pins.get(storeId);
        const amount = pin?.unitPrice?.amount;
        if (!pin || amount === undefined || min === undefined || min <= 0) return null;
        const ratio = amount / min;
        maxRatio = Math.max(maxRatio, ratio);
        return {
          itemKey: rail.itemKey,
          label: rail.label,
          storeId: pin.storeId,
          storeName: pin.storeName,
          productName: pin.productName,
          unitPrice: pin.unitPrice as Money,
          unitPriceBasis: pin.unitPriceBasis,
          ratio,
          height: heightFor(ratio),
          capped: ratio > RATIO_CAP,
          cheapest: pin.cheapest,
          flag: pin.flag === "imprecise" ? "imprecise" : "ok",
        };
      }),
    );
  }

  // Degenerate guard: below two stores or two staples with anything on them,
  // there is no landscape to draw, only a remark.
  const rowsWithCells = cells.filter((row) => row.some(Boolean)).length;
  if (stores.length < 2 || rowsWithCells < 2) return null;

  return {
    country,
    currency: countryRails[0]?.currency ?? DEFAULT_CURRENCY_BY_COUNTRY[country],
    staples,
    stores,
    cells,
    maxRatio,
  };
}

export function findCell(grid: TerrainGrid, ref: CellRef): TerrainCell | null {
  if (ref.country !== grid.country) return null;
  const row = grid.staples.findIndex((staple) => staple.itemKey === ref.itemKey);
  const col = grid.stores.findIndex((store) => store.storeId === ref.storeId);
  if (row < 0 || col < 0) return null;
  return grid.cells[row]?.[col] ?? null;
}

/**
 * The other half of `findCell`: a store and a staple that are both on this
 * landscape, with nothing standing where they cross.
 *
 * A gap is pointable now, so it has to be sayable. What it does not carry is a
 * reason -- the grid drops a pin before it becomes a cell and never learns
 * whether it was missing, suspect, or unpriced, and inventing a cause here
 * would be the one thing this page cannot afford. The staple's own section
 * below names every excluded pin in full; this only has to say there is
 * nothing here to compare.
 */
export function findGap(
  grid: TerrainGrid,
  ref: CellRef,
): { storeName: string; label: string } | null {
  if (ref.country !== grid.country) return null;
  const row = grid.staples.findIndex((staple) => staple.itemKey === ref.itemKey);
  const col = grid.stores.findIndex((store) => store.storeId === ref.storeId);
  if (row < 0 || col < 0) return null;
  if (grid.cells[row]?.[col]) return null;
  const staple = grid.staples[row];
  const store = grid.stores[col];
  if (!staple || !store) return null;
  return { storeName: store.storeName, label: staple.label };
}

/** What a gap says, everywhere it is said. */
export const GAP_READING = "no comparable price";
