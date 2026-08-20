import { type PulledRow } from "./puller.types.js";

export type PriceChange = PulledRow & {
  change: "new" | "price";
  previousPrice: number | null;
  delta: number | null;
};

/**
 * Emit a row only where the price is new or has moved.
 *
 * Grocery prices barely move day to day, so storing full snapshots would be
 * almost entirely duplicate -- 28,376 observations across the first load
 * carried 30 real moves. Making the change the stored thing makes the
 * interesting query the cheap one.
 *
 * Pure on purpose: previous prices come from the caller, so the rule is
 * testable without a database and the same logic serves any source of history.
 */
export function diff(previous: Map<string, number>, rows: PulledRow[]): PriceChange[] {
  const changes: PriceChange[] = [];
  for (const row of rows) {
    const before = previous.get(row.productKey);
    if (before === undefined) {
      changes.push({ ...row, change: "new", previousPrice: null, delta: null });
      continue;
    }
    // A float epsilon, not equality: prices arrive as parsed decimals and
    // 4.29 - 4.29 is not reliably 0 once it has been through two languages.
    if (Math.abs(before - row.price) > 1e-9) {
      changes.push({
        ...row,
        change: "price",
        previousPrice: before,
        delta: round(row.price - before, 4),
      });
    }
  }
  return changes;
}

/** A paginated API can repeat a product across pages; identity is the product key. */
export function dedupe(rows: PulledRow[]): PulledRow[] {
  const seen = new Set<string>();
  const out: PulledRow[] = [];
  for (const row of rows) {
    if (seen.has(row.productKey)) continue;
    seen.add(row.productKey);
    out.push(row);
  }
  return out;
}

/**
 * Is this run's change rate too high to believe?
 *
 * A near-total change rate on an established store is far more likely to be a
 * product_key scheme change than a real repricing of every item. Recording the
 * observations anyway would overwrite real price history with noise, so the
 * caller keeps the run as evidence and leaves the history alone.
 *
 * "Established" matters: a store's first pull changes 100% of its prices by
 * definition, and that is not suspicious.
 */
export function isMassChange(rowCount: number, changeCount: number, established: boolean): boolean {
  return established && rowCount > 100 && changeCount / rowCount > 0.9;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
