const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "₱": "PHP",
  "€": "EUR",
  "£": "GBP",
};

/** A three-letter code at the start, not followed by another letter. */
const RE_CODE = /^([A-Za-z]{3})(?![A-Za-z])/;

/**
 * Collectors echo whatever the page showed into the currency field: a symbol,
 * a code, or the whole price label ("USD 11.99"). Anything that is not
 * reducible to a three-letter code returns null, so buildRow falls back to the
 * store's own currency instead of persisting junk the contract will reject.
 */
export function normaliseCurrencyCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const symbol = CURRENCY_SYMBOLS[trimmed];
  if (symbol) return symbol;
  const code = RE_CODE.exec(trimmed)?.[1];
  return code ? code.toUpperCase() : null;
}
