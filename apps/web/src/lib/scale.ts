/** "2.4x" past a doubling, "36%" under it -- the register a shopper thinks in. */
export function spread(low: number, high: number): string {
  if (low <= 0) return "";
  const times = high / low;
  return times >= 2 ? `${times.toFixed(1)}x` : `${Math.round((times - 1) * 100)}%`;
}
