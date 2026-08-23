import { describe, expect, it } from "vitest";
import { filterStapleUrls, slugWords, termHits, type StapleMatchRule } from "./staples.js";

/** Real shapes from items.json: rules are data, these mirror the seed. */
const rice: StapleMatchRule = {
  must: ["rice"],
  mustByCountry: { PH: ["bigas"] },
  exclude: ["cake", "cracker", "vinegar", "wine", "paper", "noodle"],
};
const oil: StapleMatchRule = {
  must: ["oil"],
  mustByCountry: { PH: ["mantika"] },
  exclude: ["motor", "essential", "engine"],
};

describe("slugWords", () => {
  it("takes the last path segment, lowercased, non-alphanumerics as spaces", () => {
    expect(slugWords("https://ever.ph/products/Jasmine-Rice_5kg")).toBe(" jasmine rice 5kg ");
  });

  it("ignores a trailing slash", () => {
    expect(slugWords("https://ever.ph/products/bigas-dinorado/")).toBe(" bigas dinorado ");
  });
});

describe("termHits", () => {
  const toks = (s: string) => {
    const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const out = new Set(words);
    for (const w of words) if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
    return out;
  };

  it("matches a plural slug against a singular term and vice versa", () => {
    expect(termHits("egg", " fresh eggs dozen ", toks(" fresh eggs dozen "))).toBe(true);
    expect(termHits("eggs", " brown egg tray ", toks(" brown egg tray "))).toBe(true);
  });

  it("requires multi-word terms to appear as a phrase", () => {
    expect(termHits("cooking oil", " golden cooking oil 1l ", toks(" golden cooking oil 1l "))).toBe(
      true,
    );
    expect(termHits("cooking oil", " oil painting cooking set ", toks(" oil painting cooking set "))).toBe(
      false,
    );
  });
});

describe("filterStapleUrls", () => {
  const urls = [
    "https://ever.ph/products/jasmine-rice-5kg",
    "https://ever.ph/products/rice-cracker-snack",
    "https://ever.ph/products/bigas-dinorado-5kg",
    "https://ever.ph/products/dish-soap-lemon",
    "https://ever.ph/products/vegetable-oil-1l",
  ];

  it("keeps a staple slug and drops an excluded one", () => {
    const kept = filterStapleUrls(urls, [rice], "US");
    expect(kept).toContain("https://ever.ph/products/jasmine-rice-5kg");
    // "cracker" is on rice's exclude list: rice crackers are not the staple.
    expect(kept).not.toContain("https://ever.ph/products/rice-cracker-snack");
    expect(kept).not.toContain("https://ever.ph/products/dish-soap-lemon");
  });

  it("applies country aliases only for that country", () => {
    expect(filterStapleUrls(urls, [rice], "PH")).toContain(
      "https://ever.ph/products/bigas-dinorado-5kg",
    );
    expect(filterStapleUrls(urls, [rice], "US")).not.toContain(
      "https://ever.ph/products/bigas-dinorado-5kg",
    );
  });

  it("preserves the input order, so upstream ranking survives", () => {
    const kept = filterStapleUrls(urls, [rice, oil], "PH");
    expect(kept).toEqual([
      "https://ever.ph/products/jasmine-rice-5kg",
      "https://ever.ph/products/bigas-dinorado-5kg",
      "https://ever.ph/products/vegetable-oil-1l",
    ]);
  });

  it("a URL passes if ANY staple accepts it, even when another excludes it", () => {
    // "rice vinegar oil blend" is excluded by rice (vinegar) but oil accepts it.
    const kept = filterStapleUrls(
      ["https://x.test/products/rice-vinegar-oil-blend"],
      [rice, oil],
      "US",
    );
    expect(kept).toHaveLength(1);
  });
});
