import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.schema.js";

const base = { DATABASE_URL: "postgres://localhost:5432/basketwatch" };

describe("validateEnv", () => {
  it("fails loudly without a database url", () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it("treats an empty migration url as unset", () => {
    // Prod compose passes `${MIGRATION_DATABASE_URL:-}`, so unset arrives as "".
    expect(validateEnv({ ...base, MIGRATION_DATABASE_URL: "" }).MIGRATION_DATABASE_URL).toBe(
      undefined,
    );
  });

  it("keeps a migration url when one is given", () => {
    const url = "postgres://owner@localhost:5432/basketwatch";
    expect(validateEnv({ ...base, MIGRATION_DATABASE_URL: url }).MIGRATION_DATABASE_URL).toBe(url);
  });

  it("rejects a port that is not a number", () => {
    expect(() => validateEnv({ ...base, PORT: "lots" })).toThrow(/Invalid environment/);
  });
});
