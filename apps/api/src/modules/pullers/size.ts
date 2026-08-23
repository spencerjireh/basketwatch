/**
 * Size parsing, ported from the Python exploration codebase that preceded
 * this repo.
 *
 * Unit price is the comparison primitive -- it is what lets a 500 g loaf and a
 * 1 lb loaf be compared honestly across two countries -- and almost no store
 * publishes it in markup. So the size comes out of the product title, and
 * anything ambiguous returns null rather than a guess: a wrong unit price
 * silently breaks every cross-store comparison, which is worse than no unit
 * price at all.
 *
 * Pure and IO-free, like the validator checks, because these rules are the part
 * most likely to be wrong and the part cheapest to test.
 */

export type SizeForm = "plain" | "multipack" | "fraction" | "range" | "volume" | "count";
export type BaseUom = "g" | "ml" | "count";

export type Size = {
  /** the substring the size was read from, kept for the products.unit column */
  raw: string;
  value: number;
  uom: string;
  approximate: boolean;
  form: SizeForm;
  quantity: number;
  baseUom: BaseUom;
};

export type UnitPrice = {
  perBaseUnit: number;
  baseUom: BaseUom;
  /** per_kg | per_litre | per_item -- the readable form, not the base */
  basis: string;
  value: number;
  approximate: boolean;
};

const MASS_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilo: 1000,
  kilogram: 1000,
  oz: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
};
const VOL_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  liters: 1000,
  litres: 1000,
  floz: 29.5735,
  gal: 3785.41,
  qt: 946.353,
};
const COUNT_UNITS: Record<string, number> = {
  ct: 1,
  count: 1,
  pc: 1,
  pcs: 1,
  piece: 1,
  pieces: 1,
  s: 1,
  dozen: 12,
  doz: 12,
};
/** "pack" and "box" say how many bundles, not how much is in them. */
const AMBIGUOUS_UNITS = new Set(["pack", "packs", "pk", "box", "case", "bundle", "set", "tray"]);

const UOM = [
  ...Object.keys(MASS_TO_G),
  ...Object.keys(VOL_TO_ML),
  ...Object.keys(COUNT_UNITS),
  ...AMBIGUOUS_UNITS,
]
  .sort((a, b) => b.length - a.length)
  .join("|");

const RE_MULTIPACK = new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*-?\\s*(${UOM})\\b`, "i");
const RE_RANGE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(?:${UOM})?\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s*(${UOM})\\b`,
  "i",
);
const RE_FRACTION = new RegExp(`(\\d+)\\s*/\\s*(\\d+)\\s*-?\\s*(${UOM})\\b`, "i");
const RE_FLOZ = /(\d+(?:\.\d+)?)\s*fl\.?\s*oz\b/i;
const RE_PLAIN = new RegExp(`(?<![\\d/.])(\\d+(?:\\.\\d+)?)\\s*-?\\s*(${UOM})\\b`, "gi");
const RE_COUNT_APOS = /(\d+)\s*'?s\b/;
const RE_APPROX = /\bapprox\w*\b/i;

function normUom(u: string): string {
  return (u || "").toLowerCase().replace(/\./g, "").trim();
}

/** Grams, millilitres or a count. Null when the unit says nothing about quantity. */
export function toBase(value: number, uom: string): { quantity: number; baseUom: BaseUom } | null {
  const u = normUom(uom);
  if (u in MASS_TO_G) return { quantity: round(value * MASS_TO_G[u]!, 4), baseUom: "g" };
  if (u in VOL_TO_ML) return { quantity: round(value * VOL_TO_ML[u]!, 4), baseUom: "ml" };
  if (u in COUNT_UNITS) return { quantity: round(value * COUNT_UNITS[u]!, 4), baseUom: "count" };
  return null;
}

/**
 * Pull a size out of a product title.
 *
 * Handles multipacks ("12 x 2g" = 24 g), fractions ("1/4 Kg" = 250 g), ranges
 * ("500g-600g" -> midpoint, flagged approximate), fluid ounces and bare counts
 * ("12's", "30pcs"). Returns null rather than guessing when the unit is a
 * bundle of unknown contents, such as "6 Pack".
 *
 * Order matters: the specific forms are tried before the plain one, because
 * "12 x 2g" also matches the plain pattern and would read as 2 g.
 */
export function parseSize(text: string): Size | null {
  if (!text) return null;
  // Titles carry non-breaking spaces between number and unit; normalise first.
  const t = text.replace(/\u00a0/g, " ");
  const approximate = RE_APPROX.test(t);

  const multipack = RE_MULTIPACK.exec(t);
  if (multipack) {
    const n = Number(multipack[1]);
    const each = Number(multipack[2]);
    const base = toBase(n * each, multipack[3]!);
    if (base) {
      return {
        raw: multipack[0].trim(),
        value: n * each,
        uom: normUom(multipack[3]!),
        approximate,
        form: "multipack",
        ...base,
      };
    }
  }

  const fraction = RE_FRACTION.exec(t);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    const base = den ? toBase(num / den, fraction[3]!) : null;
    if (base) {
      return {
        raw: fraction[0].trim(),
        value: num / den,
        uom: normUom(fraction[3]!),
        approximate,
        form: "fraction",
        ...base,
      };
    }
  }

  const range = RE_RANGE.exec(t);
  if (range) {
    const mid = (Number(range[1]) + Number(range[2])) / 2;
    const base = toBase(mid, range[3]!);
    // Always approximate: a range is a claim about a spread, not a pack size.
    if (base) {
      return {
        raw: range[0].trim(),
        value: mid,
        uom: normUom(range[3]!),
        approximate: true,
        form: "range",
        ...base,
      };
    }
  }

  const floz = RE_FLOZ.exec(t);
  if (floz) {
    const base = toBase(Number(floz[1]), "floz");
    if (base) {
      return {
        raw: floz[0].trim(),
        value: Number(floz[1]),
        uom: "floz",
        approximate,
        form: "volume",
        ...base,
      };
    }
  }

  RE_PLAIN.lastIndex = 0;
  for (let m = RE_PLAIN.exec(t); m !== null; m = RE_PLAIN.exec(t)) {
    const uom = normUom(m[2]!);
    if (AMBIGUOUS_UNITS.has(uom)) continue;
    const base = toBase(Number(m[1]), uom);
    if (base) {
      return { raw: m[0].trim(), value: Number(m[1]), uom, approximate, form: "plain", ...base };
    }
  }

  const count = RE_COUNT_APOS.exec(t);
  if (count) {
    const n = Number(count[1]);
    return {
      raw: count[0].trim(),
      value: n,
      uom: "count",
      approximate,
      form: "count",
      quantity: n,
      baseUom: "count",
    };
  }
  return null;
}

/** Price per base unit, reported per kg / per litre / per item for readability. */
export function unitPrice(price: number | null, size: Size | null): UnitPrice | null {
  if (price === null || !size?.quantity) return null;
  const perBase = price / size.quantity;
  const display: Record<BaseUom, [string, number]> = {
    g: ["per_kg", perBase * 1000],
    ml: ["per_litre", perBase * 1000],
    count: ["per_item", perBase],
  };
  const [basis, value] = display[size.baseUom];
  return {
    perBaseUnit: round(perBase, 6),
    baseUom: size.baseUom,
    basis,
    value: round(value, 4),
    approximate: size.approximate,
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
