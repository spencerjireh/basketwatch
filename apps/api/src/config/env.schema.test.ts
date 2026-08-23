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

  // The regression these exist for: `z.coerce.boolean()` is `Boolean(v)`, and
  // `Boolean("false")` is `true`. Prod compose passes
  // `${PULL_SCHEDULE_ENABLED:-false}` -- always a non-empty string -- so the
  // catalogue schedule was armed on every deploy while every doc said it
  // shipped disarmed. It fired twice against production before this was found.
  it("reads a false flag as false, not as a non-empty string", () => {
    expect(validateEnv({ ...base, PULL_SCHEDULE_ENABLED: "false" }).PULL_SCHEDULE_ENABLED).toBe(
      false,
    );
    expect(validateEnv({ ...base, HEAL_AUTO_ENABLED: "false" }).HEAL_AUTO_ENABLED).toBe(false);
  });

  it("accepts the words a human would write", () => {
    for (const yes of ["true", "1", "yes", "on", "TRUE", " On "]) {
      expect(validateEnv({ ...base, PULL_SCHEDULE_ENABLED: yes }).PULL_SCHEDULE_ENABLED).toBe(true);
    }
    for (const no of ["false", "0", "no", "off", "OFF"]) {
      expect(validateEnv({ ...base, HEAL_AUTO_ENABLED: no }).HEAL_AUTO_ENABLED).toBe(false);
    }
  });

  it("falls back when a flag is unset or empty", () => {
    // Empty is what `${VAR:-}` delivers, and it must mean "not configured"
    // rather than "off" for a flag whose default is on.
    expect(validateEnv(base).PULL_SCHEDULE_ENABLED).toBe(false);
    expect(validateEnv({ ...base, PULL_SCHEDULE_ENABLED: "" }).PULL_SCHEDULE_ENABLED).toBe(false);
    expect(validateEnv(base).HEAL_AUTO_ENABLED).toBe(true);
    expect(validateEnv({ ...base, HEAL_AUTO_ENABLED: "" }).HEAL_AUTO_ENABLED).toBe(true);
  });

  it("reads the auto-approve kill switch as a word with a true default", () => {
    expect(validateEnv(base).HEAL_AUTO_APPROVE_ENABLED).toBe(true);
    expect(
      validateEnv({ ...base, HEAL_AUTO_APPROVE_ENABLED: "false" }).HEAL_AUTO_APPROVE_ENABLED,
    ).toBe(false);
  });

  it("caps proposals per incident at 2 by default", () => {
    expect(validateEnv(base).HEAL_MAX_ATTEMPTS_PER_INCIDENT).toBe(2);
  });

  it("refuses a flag value it cannot read, rather than guessing", () => {
    expect(() => validateEnv({ ...base, PULL_SCHEDULE_ENABLED: "maybe" })).toThrow(
      /Invalid environment/,
    );
  });
});
