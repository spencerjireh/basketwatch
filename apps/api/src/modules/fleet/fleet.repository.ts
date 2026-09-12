import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { countrySchema, type FleetScraper, type ScraperState } from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { runStatusFromDb } from "../../database/mappers/run-status.mapper.js";

type FleetRow = {
  store_id: string;
  name: string;
  country: string;
  last_run_at: string | null;
  last_run_rows: number | null;
  last_run_status: string | null;
  last_run_null_rate_pct: string | null;
  incident_id: string | null;
  incident_state: string | null;
  is_pullable: boolean;
};

/**
 * The only file in this module allowed to touch the Drizzle schema.
 *
 * Repositories return contract types, never raw rows: `numeric` arrives as a
 * string and runs.status uses an older vocabulary, and both are translated by
 * database/mappers before anything leaves here.
 */
@Injectable()
export class FleetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findAll(): Promise<FleetScraper[]> {
    // Lateral joins rather than group-bys: each one wants the most recent row
    // per store, which a join plus DISTINCT ON would compute for every store's
    // whole history first.
    const rows = (await this.db.execute(sql`
      select
        s.store_id,
        s.name,
        s.country,
        r.at as last_run_at,
        r.rows as last_run_rows,
        r.status as last_run_status,
        r.null_rate_pct::text as last_run_null_rate_pct,
        inc.id::text as incident_id,
        inc.state as incident_state,
        (s.active and s.method is not null and s.method <> 'none') as is_pullable
      from stores s
      left join lateral (
        select at, rows, status, null_rate_pct from runs
        where runs.store_id = s.store_id
        order by at desc limit 1
      ) r on true
      left join lateral (
        select id, state from incidents
        where incidents.store_id = s.store_id and incidents.state <> 'resolved'
        order by opened_at desc limit 1
      ) inc on true
      order by s.country, s.store_id
    `)) as unknown as FleetRow[];

    return rows.flatMap((row) => {
      const country = countrySchema.safeParse(row.country);
      if (!country.success) return [];

      const status = stateFor(row);
      return [
        {
          storeId: row.store_id,
          name: row.name,
          country: country.data,
          status,
          lastRunAt: row.last_run_at === null ? null : new Date(row.last_run_at).toISOString(),
          lastRunRows: row.last_run_rows ?? 0,
          nullRatePct: row.last_run_null_rate_pct
            ? Number.parseFloat(row.last_run_null_rate_pct)
            : 0,
          openIncidentId: status === "healthy" ? null : row.incident_id,
          isPullable: row.is_pullable,
        } satisfies FleetScraper,
      ];
    });
  }

  /** Returns false when no such store exists, so the controller can 404. */
  async setIndexContributor(storeId: string, contributor: boolean): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      update stores set index_contributor = ${contributor}
      where store_id = ${storeId}
      returning store_id
    `)) as unknown as { store_id: string }[];
    return rows.length > 0;
  }
}

/**
 * The board shows four states; a run only knows three.
 *
 * An open incident outranks the last run, because that is the whole claim the
 * product makes: a store whose last pull looked fine but whose incident is
 * still open is not healthy. Only when nothing is open does the last run decide.
 */
function stateFor(row: FleetRow): ScraperState {
  if (row.incident_state === "manual") return "manual_attention";

  const runStatus = runStatusFromDb(row.last_run_status);
  if (runStatus === "broken") return "broken";
  if (runStatus === "suspect") return "suspect";
  // A store that has never run, or ran before the status column was populated,
  // is not evidence of breakage. An unresolved incident is.
  return row.incident_state === null ? "healthy" : "suspect";
}
