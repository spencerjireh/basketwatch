import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  incidentKindSchema,
  incidentStateSchema,
  type Incident,
  type IncidentState,
  type Page,
  type PageQuery,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { decodeCursor, encodeCursor } from "../../common/pagination.js";
import { summarise, toEvidence } from "./evidence.js";

type IncidentRow = {
  id: string;
  store_id: string | null;
  store_name: string | null;
  kind: string;
  state: string;
  opened_at: string;
  resolved_at: string | null;
  evidence: unknown;
};

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class IncidentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async page(query: PageQuery & { state?: IncidentState }): Promise<Page<Incident>> {
    const cursor = decodeCursor(query.cursor);
    const state = query.state ?? null;

    const rows = (await this.db.execute(sql`
      select
        inc.id::text as id,
        inc.store_id,
        s.name as store_name,
        inc.kind,
        inc.state,
        inc.opened_at,
        inc.resolved_at,
        inc.evidence
      from incidents inc
      left join stores s on s.store_id = inc.store_id
      where (${state}::text is null or inc.state = ${state})
        and (
          ${cursor?.t ?? null}::timestamptz is null
          or (inc.opened_at, inc.id::text) < (${cursor?.t ?? null}::timestamptz, ${cursor?.i ?? null})
        )
      order by inc.opened_at desc, inc.id desc
      limit ${query.limit + 1}
    `)) as unknown as IncidentRow[];

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map(toIncident),
      nextCursor:
        hasMore && last
          ? encodeCursor({ t: new Date(last.opened_at).toISOString(), s: "incident", i: last.id })
          : null,
    };
  }

  async findById(id: string): Promise<Incident | null> {
    const [row] = (await this.db.execute(sql`
      select
        inc.id::text as id,
        inc.store_id,
        s.name as store_name,
        inc.kind,
        inc.state,
        inc.opened_at,
        inc.resolved_at,
        inc.evidence
      from incidents inc
      left join stores s on s.store_id = inc.store_id
      where inc.id::text = ${id}
    `)) as unknown as IncidentRow[];

    if (!row) return null;
    return toIncident(row);
  }
}

function toIncident(row: IncidentRow): Incident {
  const kind = incidentKindSchema.safeParse(row.kind);
  const resolvedKind = kind.success ? kind.data : "error";
  const state = incidentStateSchema.safeParse(row.state);
  const evidence = toEvidence(row.evidence, resolvedKind);

  return {
    id: row.id,
    storeId: row.store_id,
    // storeName is not nullable in the contract: an incident that belongs to
    // the fleet rather than to one store still needs something to render.
    storeName: row.store_name ?? "fleet",
    kind: resolvedKind,
    state: state.success ? state.data : "open",
    openedAt: new Date(row.opened_at).toISOString(),
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    summary: summarise(resolvedKind, evidence, row.evidence),
    evidence,
  };
}
