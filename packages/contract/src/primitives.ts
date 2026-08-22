import { z } from "zod";

/**
 * Shared value shapes. Every endpoint schema is built from these, so a
 * convention change happens in one place.
 *
 * Note for anyone porting a snippet from spencer-exploration: this is zod 4.
 * `z.string().datetime()` is now `z.iso.datetime()`.
 */

/**
 * ISO 8601, UTC, always a string on the wire.
 *
 * UTC is not just a serialisation choice. This is a fleet monitor: "the run
 * landed at 06:12" has to mean the same thing to both of us, and we are not in
 * the same timezone as the judges.
 */
export const timestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof timestampSchema>;

export const currencyCodeSchema = z.string().length(3).toUpperCase();
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

/**
 * Money travels as an amount plus its ISO code, never as a preformatted string:
 * the UI owns formatting, because the UI knows the locale and we do not.
 *
 * The two fields are grouped rather than sitting side by side on the parent so
 * that a careless refactor cannot separate an amount from its currency. In a
 * product that compares USD and PHP baskets, that separation is the bug that
 * costs a demo.
 *
 * The database stores money as `numeric`, which the driver hands back as a
 * string. Conversion happens in exactly one place, database/mappers/money.
 */
export const moneySchema = z.object({
  amount: z.number(),
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;

export const countries = ["US", "PH"] as const;
export const countrySchema = z.enum(countries);
export type Country = z.infer<typeof countrySchema>;

/**
 * Currency is derived from country when a store row does not carry one --
 * fleet.lock.json has no currency field, so 19 of 19 stores need this. It lives
 * in the contract because both sides need the same answer.
 */
export const DEFAULT_CURRENCY_BY_COUNTRY: Record<Country, CurrencyCode> = {
  US: "USD",
  PH: "PHP",
};

/**
 * Display names live here for the same reason the currency map does: both a
 * table caption and a nav switcher need the same answer, and a local ternary
 * would silently mislabel a third country.
 */
export const COUNTRY_NAME: Record<Country, string> = {
  US: "United States",
  PH: "Philippines",
};

/**
 * Cursor pagination, present from the first commit.
 *
 * Nothing needs it at 19 stores. It is here because pagination cannot be added
 * to a shipped contract without breaking every caller, and the target is 50+
 * stores with millions of observations. Twelve lines now, or a breaking change
 * later.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
export type Page<T> = { items: T[]; nextCursor: string | null };
