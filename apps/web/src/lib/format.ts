/**
 * Formatters, all module-level and all with an explicit locale and timezone.
 *
 * This is a hydration fix, not a style choice. `toLocaleString(undefined, ...)`
 * resolves to the server's locale on the server and the browser's on the
 * client, which is a guaranteed React hydration mismatch. A fixed locale plus
 * timeZone: "UTC" produces identical output on both sides.
 *
 * Showing UTC is also the honest thing for a fleet monitor: timestamps are ISO
 * 8601 UTC by contract, and "the run landed at 06:12" has to mean the same
 * thing to everyone reading the board.
 */

const LOCALE = "en-US";

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const dayOnly = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDateTime(iso: string): string {
  return `${dateTime.format(new Date(iso))} UTC`;
}

export function formatDay(iso: string): string {
  return dayOnly.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Money is formatted per value, because a row's currency is its own. */
export function formatMoney(amount: number, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

const axisFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Money for an axis tick: whole units only. A gridline labelled $44.12 spends
 * its precision where nobody reads it -- the exact figure belongs to the
 * point's own label and the readout, not the ruler.
 */
export function formatMoneyAxis(amount: number, currency: string): string {
  let formatter = axisFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    axisFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
];

/** Small counts read as words in a sentence; past fifteen, digits are kinder. */
export function spellNumber(value: number): string {
  return NUMBER_WORDS[value] ?? String(value);
}

export function formatPct(value: number): string {
  if (value === 0) return "0.0%";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** Relative time, computed from an explicit "now" so callers control the clock. */
export function formatRelative(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "0.5 kg" reads worse than "500 g" on a shelf, and this is a shelf. */
export function formatQuantity(quantity: number, uom: string | null): string {
  if (uom === "count") return `${quantity}`;
  if (uom === "kg" && quantity < 1) return `${Math.round(quantity * 1000)} g`;
  if (uom === "l" && quantity < 1) return `${Math.round(quantity * 1000)} ml`;
  return `${quantity} ${uom ?? ""}`.trim();
}

const BASIS_LABEL: Record<string, string> = {
  per_kg: "per kg",
  per_litre: "per litre",
  per_item: "each",
};

export function formatBasis(basis: string | null): string {
  return basis ? (BASIS_LABEL[basis] ?? "") : "";
}
