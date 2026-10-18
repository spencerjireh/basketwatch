import { describe, expect, it } from "vitest";
import { dropsQuerySchema } from "@basketwatch/contract";
import { pctBelow, searchTokens } from "./products.repository.js";

describe("searchTokens", () => {
  it("splits on spaces, lower-cases and drops one-letter words", () => {
    expect(searchTokens("Alaska  evap 370ml x")).toEqual(["alaska", "evap", "370ml"]);
  });

  it("strips LIKE wildcards so a word cannot widen the match", () => {
    expect(searchTokens("50% off_")).toEqual(["50", "off"]);
  });

  it("keeps the first of repeated words and caps the count", () => {
    expect(searchTokens("rice rice")).toEqual(["rice"]);
    expect(searchTokens("aa bb cc dd ee ff gg hh ii jj")).toHaveLength(8);
  });
});

describe("pctBelow", () => {
  it("is the share under the median, to a tenth of a percent", () => {
    expect(pctBelow(82, 100)).toBe(0.18);
    expect(pctBelow(299.5, 345)).toBe(0.132);
  });

  it("is 0 for a missing median", () => {
    expect(pctBelow(10, 0)).toBe(0);
  });
});

describe("dropsQuerySchema", () => {
  it("defaults to 30 and caps at 60", () => {
    expect(dropsQuerySchema.parse({}).limit).toBe(30);
    expect(dropsQuerySchema.safeParse({ limit: "61" }).success).toBe(false);
  });
});
