import { describe, expect, it } from "vitest";
import { productSearchQuerySchema } from "@basketwatch/contract";

/**
 * The repository branches on `q` being undefined, so what counts as undefined
 * is a contract detail worth pinning rather than a parsing formality.
 */
describe("productSearchQuerySchema", () => {
  it.each([
    ["no q at all", {}],
    ["an empty q", { q: "" }],
    ["a q of spaces", { q: "   " }],
  ])("reads %s as the browse case", (_label, input) => {
    const parsed = productSearchQuerySchema.parse(input);
    expect(parsed.q).toBeUndefined();
    expect(parsed.sort).toBe("relevance");
  });

  it("trims a real term", () => {
    expect(productSearchQuerySchema.parse({ q: "  rice  " }).q).toBe("rice");
  });

  it("refuses one character", () => {
    // Not pedantry: it matches almost every row and no index can serve it,
    // which is strictly more work than asking for nothing at all.
    expect(productSearchQuerySchema.safeParse({ q: "r" }).success).toBe(false);
    expect(productSearchQuerySchema.safeParse({ q: " r " }).success).toBe(false);
  });

  it("refuses a term longer than the column deserves", () => {
    expect(productSearchQuerySchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
  });
});
