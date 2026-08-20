import { describe, expect, it } from "vitest";
import {
  type SearchCursor,
  decodeSearchCursor,
  encodeSearchCursor,
  takeSearchPage,
} from "./search-cursor.js";

const cursor: SearchCursor = { o: "unit_price", v: "3.9600", s: "us-amigofoods", k: "12345" };

describe("encodeSearchCursor / decodeSearchCursor", () => {
  it("round-trips", () => {
    expect(decodeSearchCursor(encodeSearchCursor(cursor), "unit_price")).toEqual(cursor);
  });

  it("round-trips the nulls-last tail, where the leading value is absent", () => {
    const tail: SearchCursor = { ...cursor, v: null };
    expect(decodeSearchCursor(encodeSearchCursor(tail), "unit_price")).toEqual(tail);
  });

  it("survives a URL round-trip", () => {
    const encoded = encodeSearchCursor(cursor);
    expect(encoded).toBe(encodeURIComponent(encoded));
  });

  it("rejects a cursor minted under a different sort", () => {
    // The position it describes is in a sequence the caller is no longer
    // asking for, so seeking with it would skip or repeat rows silently.
    expect(decodeSearchCursor(encodeSearchCursor(cursor), "relevance")).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["not base64", "!!!!"],
    ["base64 of nonsense", Buffer.from("not json", "utf8").toString("base64url")],
    ["json but not an object", Buffer.from("42", "utf8").toString("base64url")],
    ["a missing tiebreak", encodeSearchCursor({ ...cursor, k: undefined as unknown as string })],
    ["an unknown sort", encodeSearchCursor({ ...cursor, o: "cheapest" as SearchCursor["o"] })],
    ["a non-string value", encodeSearchCursor({ ...cursor, v: 3.96 as unknown as string })],
  ])("returns null for %s rather than throwing", (_label, raw) => {
    expect(decodeSearchCursor(raw, "unit_price")).toBeNull();
  });
});

describe("takeSearchPage", () => {
  const rows = [1, 2, 3, 4];
  const toCursor = (n: number): SearchCursor => ({ ...cursor, k: String(n) });

  it("trims the probe row and returns a cursor when there is more", () => {
    const page = takeSearchPage(rows, 3, toCursor);
    expect(page.items).toEqual([1, 2, 3]);
    expect(decodeSearchCursor(page.nextCursor, "unit_price")?.k).toBe("3");
  });

  it("returns a null cursor on the last page", () => {
    expect(takeSearchPage(rows, 4, toCursor).nextCursor).toBeNull();
  });

  it("returns a null cursor when there are no rows at all", () => {
    expect(takeSearchPage([], 10, toCursor)).toEqual({ items: [], nextCursor: null });
  });
});
