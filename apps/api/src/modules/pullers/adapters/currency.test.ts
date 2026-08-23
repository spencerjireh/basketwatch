import { describe, expect, it } from "vitest";
import { normaliseCurrencyCode } from "./currency.js";
import { buildRow } from "./row.js";
import { type PullerConfig } from "../puller.types.js";

describe("normaliseCurrencyCode", () => {
  it.each([
    ["USD", "USD"],
    ["usd", "USD"],
    [" usd ", "USD"],
    ["USD 11.99", "USD"],
    ["PHP 389.50", "PHP"],
    ["$", "USD"],
    ["₱", "PHP"],
    ["€", "EUR"],
    ["£", "GBP"],
    ["US", null],
    ["USDX", null],
    ["1,234.00", null],
    ["", null],
    [null, null],
  ])("%j -> %j", (raw, expected) => {
    expect(normaliseCurrencyCode(raw)).toBe(expected);
  });
});

describe("buildRow currency fallback", () => {
  const config = {
    storeId: "us-kesargrocery",
    country: "US",
    currency: "USD",
  } as PullerConfig;

  it("reduces a price-label currency to its code", () => {
    const row = buildRow(config, {
      productKey: "eggs",
      name: "Eggs",
      price: 11.99,
      currency: "USD 11.99",
      url: "https://example.com/eggs",
    });
    expect(row?.currency).toBe("USD");
  });

  it("falls back to the store currency when the source value is junk", () => {
    const row = buildRow(config, {
      productKey: "eggs",
      name: "Eggs",
      price: 11.99,
      currency: "11.99",
      url: "https://example.com/eggs",
    });
    expect(row?.currency).toBe("USD");
  });
});
