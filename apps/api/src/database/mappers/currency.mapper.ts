import {
  DEFAULT_CURRENCY_BY_COUNTRY,
  type Country,
  type CurrencyCode,
} from "@basketwatch/contract";

/**
 * stores.currency is nullable and fleet.lock.json carries no currency field at
 * all, so most store rows have none. Country decides it.
 *
 * Currency is never assumed from the country at the observation level -- the
 * observation carries its own -- but a store needs a display default.
 */
export function currencyForStore(
  storeCurrency: string | null,
  country: Country,
): CurrencyCode {
  return storeCurrency ?? DEFAULT_CURRENCY_BY_COUNTRY[country];
}
