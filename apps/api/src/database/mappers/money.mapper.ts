import { type CurrencyCode, type Money } from "@basketwatch/contract";

/**
 * Drizzle returns `numeric` columns as strings, because a float cannot hold
 * money faithfully. The contract exposes money as a number plus its ISO code.
 *
 * This is the only place that conversion happens. Done inline in a repository
 * it eventually produces "12.5000" rendered in the UI, or -- worse -- string
 * concatenation inside a sum.
 */
export function toMoney(value: string | number | null, currency: CurrencyCode): Money | null {
  if (value === null) return null;
  const amount = typeof value === "number" ? value : Number.parseFloat(value);
  if (Number.isNaN(amount)) return null;
  return { amount, currency };
}