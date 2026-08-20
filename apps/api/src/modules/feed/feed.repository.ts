import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  feedEventKindSchema,
  type FeedEvent,
  type FeedEventKind,
  type PageQuery,
  type Page,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { runStatusFromDb } from "../../database/mappers/run-status.mapper.js";
import { decodeCursor, encodeCursor, type CursorSource } from "../../common/pagination.js";

type FeedRow = {
  source: CursorSource;
  id: string;
  at: string;
  store_id: string | null;
  store_name: string | null;
  incident_id: string | null;
  /** run status, incident kind, or alert kind, depending on the source */
  a: string | null;
  /** run row count, incident state, or alert channel */
  b: string | null;
  /** which half of an incident's life this row is: opened or resolved */
  phase: string | null;
};

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class FeedRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Newest first, cursor-paginated over runs, incidents and alerts. */
  async page(query: PageQuery): Promise<Page<FeedEvent>> {
    const cursor = decodeCursor(query.cursor);

    // One incident produces two events -- it opened, and later it closed --
    // which is why the id carries a suffix. Without it the two rows would
    // collide on the incident's uuid and the second page could skip one.
    const rows = (await this.db.execute(sql`
      with events as (
        select 'run'::text as source, r.id::text as id, r.at as at,
               r.store_id, null::text as incident_id, r.status as a, r.rows::text as b,
               null::text as phase
        from runs r
        where r.status in ('anomalous', 'error', 'suspect', 'broken')

        union all
        select 'incident', inc.id::text || ':opened', inc.opened_at,
               inc.store_id, inc.id::text, inc.kind, inc.state, 'opened'
        from incidents inc

        union all
        select 'incident', inc.id::text || ':resolved', inc.resolved_at,
               inc.store_id, inc.id::text, inc.kind, 'resolved', 'resolved'
        from incidents inc
        where inc.resolved_at is not null

        union all
        select 'alert', al.id::text, al.sent_at,
               null, null, al.kind, al.channel, null
        from alerts al
      )
      select e.source, e.id, e.at, e.store_id, s.name as store_name, e.incident_id, e.a, e.b, e.phase
      from events e
      left join stores s on s.store_id = e.store_id
      where ${cursor?.t ?? null}::timestamptz is null
         or (e.at, e.source, e.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.s ?? null}, ${cursor?.i ?? null})
      order by e.at desc, e.source desc, e.id desc
      limit ${query.limit + 1}
    `)) as unknown as FeedRow[];

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map(toEvent),
      nextCursor:
        hasMore && last
          ? encodeCursor({ t: new Date(last.at).toISOString(), s: last.source, i: last.id })
          : null,
    };
  }
}

function toEvent(row: FeedRow): FeedEvent {
  return {
    // The id doubles as an SSE Last-Event-ID and as a cursor, so a client that
    // drops the stream resumes from the event it last rendered.
    id: encodeCursor({ t: new Date(row.at).toISOString(), s: row.source, i: row.id }),
    at: new Date(row.at).toISOString(),
    storeId: row.store_id,
    // Not nullable in the contract: a fleet-wide alert still needs a label.
    storeName: row.store_name ?? "fleet",
    kind: kindFor(row),
    summary: summarise(row),
    incidentId: row.incident_id,
  };
}

function kindFor(row: FeedRow): FeedEventKind {
  switch (row.source) {
    case "run":
      return "breakage";
    case "incident":
      // The phase, not the state: an incident that opened this morning and
      // closed this afternoon must still read as a breakage where it opened.
      if (row.phase === "resolved") return "healed";
      return row.b === "healing" ? "healing" : "breakage";
    case "alert": {
      const parsed = feedEventKindSchema.safeParse(row.a);
      return parsed.success ? parsed.data : "breakage";
    }
  }
}

function summarise(row: FeedRow): string {
  const store = row.store_name ?? row.store_id ?? "the fleet";
  switch (row.source) {
    case "run": {
      const status = runStatusFromDb(row.a) ?? "suspect";
      return `${store} run came back ${status} with ${row.b ?? "0"} rows`;
    }
    case "incident":
      return row.phase === "resolved"
        ? `${store} recovered: ${row.a} incident closed`
        : `${store} opened a ${row.a} incident`;
    case "alert":
      return `${row.a} alert sent to ${row.b}`;
  }
}
