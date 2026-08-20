import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.schema.js";

const base = { DATABASE_URL: "postgres://localhost:5432/basketwatch" };

describe("validateEnv", () => {
  it("reads a configured balance", () => {
    expect(validateEnv({ ...base, BD_BALANCE_USD: "26.54" }).BD_BALANCE_USD).toBe(26.54);
  });

  it("treats an empty balance as unset, not as zero credits", () => {
    // Prod compose passes `${BD_BALANCE_USD:-}`, so unset arrives as "".
    // z.coerce.number() alone reads that as 0 and the meter would claim the
    // account is empty.
    expect(validateEnv({ ...base, BD_BALANCE_USD: "" }).BD_BALANCE_USD).toBeUndefined();
    expect(validateEnv(base).BD_BALANCE_USD).toBeUndefined();
  });

  it("still rejects a balance that is not a number", () => {
    expect(() => validateEnv({ ...base, BD_BALANCE_USD: "lots" })).toThrow(/Invalid environment/);
  });

  it("fails loudly without a database url", () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});
