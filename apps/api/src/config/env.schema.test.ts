import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.schema.js";

const base = { DATABASE_URL: "postgres://localhost:5432/basketwatch" };

describe("validateEnv", () => {
  it("fails loudly without a database url", () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it("treats an empty concurrency as unset, not as zero workers", () => {
    // Prod compose passes `${SCRAPE_CONCURRENCY:-}`, so unset arrives as "".
    // z.coerce.number() alone reads that as 0, below the minimum.
    expect(validateEnv({ ...base, SCRAPE_CONCURRENCY: "" }).SCRAPE_CONCURRENCY).toBe(3);
    expect(validateEnv({ ...base, SCRAPE_CONCURRENCY: "2" }).SCRAPE_CONCURRENCY).toBe(2);
  });

  it("still rejects a concurrency that is not a number", () => {
    expect(() => validateEnv({ ...base, SCRAPE_CONCURRENCY: "lots" })).toThrow(
      /Invalid environment/,
    );
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
  });

  it("accepts the words a human would write", () => {
    for (const yes of ["true", "1", "yes", "on", "TRUE", " On "]) {
      expect(validateEnv({ ...base, PULL_SCHEDULE_ENABLED: yes }).PULL_SCHEDULE_ENABLED).toBe(true);
    }
    for (const no of ["false", "0", "no", "off", "OFF"]) {
      expect(validateEnv({ ...base, PULL_SCHEDULE_ENABLED: no }).PULL_SCHEDULE_ENABLED).toBe(false);
    }
  });

  it("falls back when a flag is unset or empty", () => {
    // Empty is what `${VAR:-}` delivers, and it must mean "not configured"
    // rather than a value.
    expect(validateEnv(base).PULL_SCHEDULE_ENABLED).toBe(false);
    expect(validateEnv({ ...base, PULL_SCHEDULE_ENABLED: "" }).PULL_SCHEDULE_ENABLED).toBe(false);
  });

  it("refuses a flag value it cannot read, rather than guessing", () => {
    expect(() => validateEnv({ ...base, PULL_SCHEDULE_ENABLED: "maybe" })).toThrow(
      /Invalid environment/,
    );
  });
});
