import { productSortSchema, type ProductSort } from "@basketwatch/contract";

/**
 * The product-search cursor.
 *
 * A second codec rather than a widening of `Cursor`, because the two have
 * genuinely different invariants and `Cursor`'s are load-bearing elsewhere: its
 * `t` must parse as a date, its `s` must be one of three feed tables, and the
 * same encoding doubles as the SSE Last-Event-ID that a reconnecting client
 * hands straight back to the feed query. A search key has no timestamp, and its
 * leading component is a nullable numeric. Adding "product" to `cursorSources`
 * would mean either forging a date into `t` -- which `decodeCursor`'s own
 * Date.parse check rejects -- or deleting that check, which relaxes validation
 * on the feed path to serve a query that never touches it.
 *
 * Two codecs, each strict about its own shape. Decoding never throws, for the
 * same reason: a truncated or stale cursor degrades to the first page.
 */
export type SearchCursor = {
  /** which ordering produced it; a cursor is not portable across sorts */
  o: ProductSort;
  /** the leading sort value, stringified. null is the nulls-last tail */
  v: string | null;
  /** the (store_id, product_key) tiebreak that makes the key total */
  s: string;
  k: string;
};

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * `sort` is the ordering the caller is asking for now. A cursor minted under a
 * different one describes a position in a sequence that no longer exists, so it
 * is rejected rather than seeked with.
 */
export function decodeSearchCursor(
  raw: string | undefined | null,
  sort: ProductSort,
): SearchCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { o, v, s, k } = parsed as Record<string, unknown>;
    if (typeof s !== "string" || typeof k !== "string") return null;
    if (v !== null && typeof v !== "string") return null;
    if (!productSortSchema.safeParse(o).success) return null;
    if (o !== sort) return null;
    return { o: o as ProductSort, v, s, k };
  } catch {
    return null;
  }
}

/** The search sibling of takePage: one extra row answers "is there more?". */
export function takeSearchPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => SearchCursor,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeSearchCursor(toCursor(last)) : null,
  };
}
