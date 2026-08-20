import { describe, expect, it } from "vitest";
import { type Cursor, decodeCursor, encodeCursor, takePage } from "./pagination.js";

const cursor: Cursor = { t: "2026-08-20T06:00:00.000Z", s: "run", i: "19" };

describe("encodeCursor / decodeCursor", () => {
  it("round-trips", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("survives a URL round-trip", () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toBe(encodeURIComponent(encoded));
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["not base64", "!!!!"],
    ["base64 of nonsense", Buffer.from("not json", "utf8").toString("base64url")],
    ["json but not an object", Buffer.from("42", "utf8").toString("base64url")],
    ["missing the id", encodeCursor({ ...cursor, i: undefined as unknown as string })],
    ["an unknown source", encodeCursor({ ...cursor, s: "wat" as Cursor["s"] })],
    ["an unparseable timestamp", encodeCursor({ ...cursor, t: "yesterday" })],
  ])("returns null for %s rather than throwing", (_label, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("takePage", () => {
  const rows = [1, 2, 3, 4];
  const toCursor = (n: number): Cursor => ({ ...cursor, i: String(n) });

  it("trims the probe row and returns a cursor when there is more", () => {
    const page = takePage(rows, 3, toCursor);
    expect(page.items).toEqual([1, 2, 3]);
    expect(decodeCursor(page.nextCursor)?.i).toBe("3");
  });

  it("returns a null cursor on the last page", () => {
    expect(takePage(rows, 4, toCursor).nextCursor).toBeNull();
  });

  it("returns a null cursor when there are no rows at all", () => {
    expect(takePage([], 10, toCursor)).toEqual({ items: [], nextCursor: null });
  });
});
