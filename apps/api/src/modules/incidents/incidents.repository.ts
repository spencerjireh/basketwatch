import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  healVerdictSchema,
  incidentKindSchema,
  incidentStateSchema,
  canaryResultSchema,
  type HealAttempt,
  type Incident,
  type IncidentState,
  type Page,
  type PageQuery,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { toMoney } from "../../database/mappers/money.mapper.js";
import { decodeCursor, encodeCursor } from "../../common/pagination.js";
import { summarise, toEvidence } from "./evidence.js";

const USD = "USD";

type IncidentRow = {
  id: string;
  store_id: string | null;
  store_name: string | null;
  collector_id: string | null;
  kind: string;
  state: string;
  opened_at: string;
  resolved_at: string | null;
  evidence: unknown;
};

type AttemptRow = {
  id: string;
  incident_id: string;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  claude_diagnosis: string;
  heal_prompt: string;
  studio_diff: string | null;
  canary: unknown;
  verdict: string | null;
  credits_spent: string | null;
};

/**
 * The only file in this module allowed to touch the Drizzle schema.
 *
 * Attempts come back in a second query rather than a join: the audit view wants
 * every attempt for the incidents on this page, and joining would multiply the
 * fat evidence blob by the attempt count over the wire.
 */
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
        coalesce(inc.scraper_id, s.studio_collector_id) as collector_id,
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
    const attempts = await this.attemptsFor(page.map((row) => row.id));
    const last = page.at(-1);

    return {
      items: page.map((row) => toIncident(row, attempts.get(row.id) ?? [])),
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
        coalesce(inc.scraper_id, s.studio_collector_id) as collector_id,
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
    const attempts = await this.attemptsFor([row.id]);
    return toIncident(row, attempts.get(row.id) ?? []);
  }

  /** Every attempt for the incidents on this page, oldest first. */
  private async attemptsFor(incidentIds: string[]): Promise<Map<string, HealAttempt[]>> {
    const byIncident = new Map<string, HealAttempt[]>();
    if (incidentIds.length === 0) return byIncident;

    const rows = (await this.db.execute(sql`
      select
        ha.id::text as id,
        ha.incident_id::text as incident_id,
        ha.attempt,
        ha.started_at,
        ha.finished_at,
        ha.claude_diagnosis,
        ha.heal_prompt,
        ha.studio_diff,
        ha.canary,
        ha.verdict,
        ha.credits_spent::text as credits_spent
      from heal_attempts ha
      where ha.incident_id::text in (${sql.join(
        incidentIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by ha.incident_id, ha.attempt, ha.started_at
    `)) as unknown as AttemptRow[];

    for (const row of rows) {
      const attempts = byIncident.get(row.incident_id) ?? [];
      attempts.push(toAttempt(row));
      byIncident.set(row.incident_id, attempts);
    }
    return byIncident;
  }
}

function toIncident(row: IncidentRow, attempts: HealAttempt[]): Incident {
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
    collectorId: row.collector_id,
    kind: resolvedKind,
    state: state.success ? state.data : "open",
    openedAt: new Date(row.opened_at).toISOString(),
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    summary: summarise(resolvedKind, evidence, row.evidence),
    evidence,
    attempts,
  };
}

function toAttempt(row: AttemptRow): HealAttempt {
  const canary = canaryResultSchema.safeParse(row.canary);
  const verdict = healVerdictSchema.safeParse(row.verdict);

  return {
    id: row.id,
    incidentId: row.incident_id,
    attempt: row.attempt,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
    diagnosis: row.claude_diagnosis,
    healPrompt: row.heal_prompt,
    studioDiff: row.studio_diff,
    canary: canary.success ? canary.data : null,
    verdict: verdict.success ? verdict.data : null,
    // The column is nullable and the contract is not: an attempt whose cost
    // was never recorded spent nothing we can prove, and zero says that.
    creditsSpent: toMoney(row.credits_spent, USD) ?? { amount: 0, currency: USD },
  };
}
