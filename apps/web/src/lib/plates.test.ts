import { describe, expect, it } from "vitest";
import { PLATE_KEYS, PLATE_SEARCH, plateSrc } from "@/lib/plates";

describe("plateSrc", () => {
  it("resolves every basket key to its plate", () => {
    for (const key of PLATE_KEYS) {
      expect(plateSrc(key)).toBe(`/plates/${key}.svg`);
    }
  });

  it("returns null rather than guessing for an unknown key", () => {
    expect(plateSrc("caviar")).toBeNull();
  });
});

describe("PLATE_SEARCH", () => {
  it("carries a label and a typeable query for every plate", () => {
    for (const key of PLATE_KEYS) {
      const entry = PLATE_SEARCH[key];
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.query.length).toBeGreaterThan(0);
      // The query is typed into a free-text search over product names, so a
      // raw snake_case key would match nothing.
      expect(entry.query).not.toContain("_");
    }
  });
});
