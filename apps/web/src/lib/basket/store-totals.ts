import { DEFAULT_CURRENCY_BY_COUNTRY, type Country, type Rail } from "@basketwatch/contract";

/**
 * What the basket costs at each store, ranked.
 *
 * Pure math with no React in it, for the same reason `lib/terrain/model.ts` is:
 * three surfaces read this ranking -- the bar chart, the landscape's column
 * order, and the headline's spread figure -- and they must never disagree about
 * which store is cheapest.
 *
 * The rule for what counts is copied from the index rather than invented here.
 * A pin contributes only if it is not suspect, carries a unit price, and is an
 * index contributor: exactly the pins the basket total is built from. Anything
 * looser and this chart could crown a winner the cheapest cart does not
 * recognise, on the same screen.
 */

export type StoreTotal = {
  storeId: string;
  storeName: string;
  /** what the staples this store does price cost here, at the index quantities */
  total: number;
  /** how many staples that was */
  covered: number;
  /**
   * Averaged over the staples it prices: this store's price over the cheapest
   * price anyone charges for that staple.
   *
   * The bar is drawn from this and not from `total`, because coverage is
   * uneven and the staples are not interchangeable. A raw total rewards a
   * store for the staples it fails to price, and an average staple cost
   * rewards it for pricing only the cheap ones -- rice and not olive oil. A
   * ratio is measured against the same staple at every other store, so neither
   * trick works on it.
   *
   * It is the unit the landscape overhead is already drawn in: height there is
   * times the cheapest too, so the leftmost column and the top bar say the
   * same thing. What it still cannot fix is a store priced on four staples
   * looking sure of itself, which is why the coverage count sits beside every
   * bar rather than under a tooltip.
   */
  meanRatio: number;
  complete: boolean;
};

/** A store the landscape can draw but the basket cannot total. */
export type IgnoredStore = {
  storeId: string;
  storeName: string;
  reason: "not counted by the index" | "no comparable price";
  /**
   * The same figure the ranked stores carry, measured the same way, for a store
   * the index does not count. It buys nothing on the bar chart -- this store has
   * no bar -- but the landscape draws its column anyway, and a column placed by
   * name in a row of columns placed by price is a landscape that lies about its
   * own slope. Null where there was nothing comparable to measure.
   */
  meanRatio: number | null;
};

export type StoreRanking = {
  country: Country;
  currency: string;
  /**
   * The staples this ranking could actually price: carrying an index quantity,
   * and with at least one contributing store holding a usable price on them.
   *
   * The second half of that is not pedantry. A staple every store fails --
   * one dead scraper, one pin nobody has resolved -- is coverable by nobody, so
   * counting it here would leave `complete` false for every store at once: no
   * spread sentence in the headline, and ten stores each reading "prices nine
   * of ten" over a basket they priced identically.
   */
  priceable: number;
  /** cheapest first */
  ranked: StoreTotal[];
  ignored: IgnoredStore[];
};

export function rankStores(rails: Rail[], country: Country): StoreRanking {
  const countryRails = rails.filter((rail) => rail.country === country);
  const currency = countryRails[0]?.currency ?? DEFAULT_CURRENCY_BY_COUNTRY[country];

  // Every store the landscape can draw, so that each one ends up either ranked
  // or named as ignored. A store present on the terrain and absent from both
  // lists would read as an oversight.
  const seen = new Map<string, string>();
  for (const rail of countryRails) {
    for (const pin of rail.pins) {
      if (pin.flag === "suspect" || pin.unitPrice === null) continue;
      seen.set(pin.storeId, pin.storeName);
    }
  }

  const priceableRails = countryRails.filter((rail) => rail.indexQuantity !== null);
  const totals = new Map<string, { total: number; ratio: number; covered: number }>();
  // The same running ratio for the stores the index does not count, kept apart
  // so it can never reach a bar, a total, or the headline's spread. It exists
  // to place their columns on the landscape, and for nothing else.
  const outside = new Map<string, { ratio: number; covered: number }>();
  const nonContributor = new Set<string>();
  let priceable = 0;

  for (const rail of priceableRails) {
    const quantity = rail.indexQuantity as number;
    const outsiders: Rail["pins"] = [];
    const countable = rail.pins.filter((pin) => {
      if (pin.flag === "suspect" || pin.unitPrice === null) return false;
      if (!pin.indexContributor) {
        nonContributor.add(pin.storeId);
        outsiders.push(pin);
        return false;
      }
      return true;
    });
    // The yardstick is this staple's own cheapest shelf, recomputed over the
    // countable pins rather than read off the rail: the rail's `cheapest` flag
    // is computed over every non-suspect pin, including the ones the index
    // ignores, and a ranking measured against a store it excludes would be
    // measuring against nothing the reader can see here.
    const cheapest = Math.min(...countable.map((pin) => pin.unitPrice?.amount ?? Infinity));
    if (!Number.isFinite(cheapest) || cheapest <= 0) continue;

    // Counted here rather than off `priceableRails`, because the rails that
    // fall out above are the ones no store could have covered.
    priceable += 1;

    for (const pin of outsiders) {
      const amount = pin.unitPrice?.amount;
      if (amount === undefined) continue;
      const entry = outside.get(pin.storeId) ?? { ratio: 0, covered: 0 };
      entry.ratio += amount / cheapest;
      entry.covered += 1;
      outside.set(pin.storeId, entry);
    }

    for (const pin of countable) {
      const amount = pin.unitPrice?.amount;
      if (amount === undefined) continue;
      // Unit price times the tracked quantity, never the sticker price: two
      // stores rarely sell the same pack, and the index compares them at the
      // same quantity for exactly that reason.
      const entry = totals.get(pin.storeId) ?? { total: 0, ratio: 0, covered: 0 };
      entry.total += amount * quantity;
      entry.ratio += amount / cheapest;
      entry.covered += 1;
      totals.set(pin.storeId, entry);
    }
  }

  const ranked: StoreTotal[] = [];
  const ignored: IgnoredStore[] = [];

  for (const [storeId, storeName] of seen) {
    const entry = totals.get(storeId);
    if (!entry || entry.covered === 0) {
      const shadow = outside.get(storeId);
      ignored.push({
        storeId,
        storeName,
        reason: nonContributor.has(storeId) ? "not counted by the index" : "no comparable price",
        meanRatio: shadow && shadow.covered > 0 ? shadow.ratio / shadow.covered : null,
      });
      continue;
    }
    ranked.push({
      storeId,
      storeName,
      total: entry.total,
      covered: entry.covered,
      meanRatio: entry.ratio / entry.covered,
      complete: priceable > 0 && entry.covered === priceable,
    });
  }

  // The name is the tie-break so that the order is deterministic between the
  // server render and the client's, which a Map's insertion order is not.
  ranked.sort((a, b) => a.meanRatio - b.meanRatio || a.storeName.localeCompare(b.storeName));
  ignored.sort((a, b) => a.storeName.localeCompare(b.storeName));

  return { country, currency, priceable, ranked, ignored };
}

/**
 * Column order for the landscape: every store by its multiple of the cheapest
 * shelf, cheapest to dearest, with the ones carrying no such figure at the end.
 *
 * Ranked and ignored are interleaved rather than concatenated. The landscape
 * draws a column for every store it can, including the ones the index refuses
 * to count, and appending those by name put half the US terrain in alphabetical
 * order under a hero that says it rises left to right.
 *
 * The comparator is the one `rankStores` sorted `ranked` with, so the ranked
 * stores keep their relative order: the bars below are a subsequence of the
 * columns above, which is what lets the hero name two stores and the chart
 * agree. What this does not promise is that the leftmost column is the lowest
 * ridge -- see `lib/terrain/model.ts`, which measures height against every
 * shelf on the row and not only the counted ones.
 */
export function storeOrder(ranking: StoreRanking): string[] {
  return [...ranking.ranked, ...ranking.ignored]
    .sort(
      (a, b) =>
        (a.meanRatio ?? Infinity) - (b.meanRatio ?? Infinity) ||
        a.storeName.localeCompare(b.storeName),
    )
    .map((store) => store.storeId);
}

/**
 * The headline's figure: what the whole basket costs at the cheapest store and
 * at the dearest, over the stores that price every staple.
 *
 * Complete baskets only. A range whose ends were measured over different
 * staples is not a range, and below two of them there is nothing to span, so
 * the sentence is dropped rather than padded.
 */
export function basketSpread(
  ranking: StoreRanking,
): { low: number; high: number; currency: string } | null {
  const complete = ranking.ranked.filter((store) => store.complete);
  if (complete.length < 2) return null;
  const totals = complete.map((store) => store.total);
  return { low: Math.min(...totals), high: Math.max(...totals), currency: ranking.currency };
}
