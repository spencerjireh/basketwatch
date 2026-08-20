/**
 * Opaque cursors for the two list endpoints.
 *
 * The feed merges three tables whose keys are not comparable -- runs.id is a
 * bigserial, incidents.id and alerts.id are uuids -- so a cursor cannot be a
 * bare id. The sort key is (timestamp desc, source, id), and all three parts
 * travel in the cursor.
 *
 * The same encoding is the FeedEvent id, so an SSE client reconnecting with
 * Last-Event-ID hands back something the feed query can seek with directly.
 *
 * Decoding never throws: a cursor that has been truncated by a proxy, or kept
 * across a deploy, degrades to the first page rather than a 500.
 */

/** Which table a feed row came from; part of the sort key, so it must be stable. */
export const cursorSources = ["run", "incident", "alert"] as const;
export type CursorSource = (typeof cursorSources)[number];

export type Cursor = {
  /** ISO 8601 UTC, the row's own timestamp */
  t: string;
  s: CursorSource;
  /** the row's primary key, stringified */
  i: string;
};

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { t, s, i } = parsed as Record<string, unknown>;
    if (typeof t !== "string" || typeof i !== "string") return null;
    if (typeof s !== "string" || !cursorSources.includes(s as CursorSource)) return null;
    if (Number.isNaN(Date.parse(t))) return null;
    return { t, s: s as CursorSource, i };
  } catch {
    return null;
  }
}

/**
 * Take one more row than asked for, and the extra row is the answer to "is
 * there a next page?" without a second count query.
 */
export function takePage<T>(rows: T[], limit: number, toCursor: (row: T) => Cursor) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
  };
}
