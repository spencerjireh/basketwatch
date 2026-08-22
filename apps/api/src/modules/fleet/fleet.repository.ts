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
  collector_id: string | null;
  last_run_at: string | null;
  last_run_rows: number | null;
  last_run_status: string | null;
  last_run_null_rate_pct: string | null;
  incident_id: string | null;
  incident_state: string | null;
  heals_today: string;
  has_template: boolean;
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
    // Three lateral joins rather than three group-bys: each one wants the most
    // recent row per store, which a join plus DISTINCT ON would compute for
    // every store's whole history first.
    const rows = (await this.db.execute(sql`
      select
        s.store_id,
        s.name,
        s.country,
        s.studio_collector_id as collector_id,
        r.at as last_run_at,
        r.rows as last_run_rows,
        r.status as last_run_status,
        r.null_rate_pct::text as last_run_null_rate_pct,
        inc.id::text as incident_id,
        inc.state as incident_state,
        coalesce(heals.n, 0)::text as heals_today,
        exists(
          select 1 from scraper_templates st
          where st.scraper_id = s.studio_collector_id
        ) as has_template,
        (s.method is not null and s.method <> 'none') as is_pullable
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
      left join lateral (
        select count(*) as n from heal_attempts ha
        join incidents i2 on i2.id = ha.incident_id
        where i2.store_id = s.store_id and ha.started_at >= current_date
      ) heals on true
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
          collectorId: row.collector_id,
          status,
          lastRunAt: row.last_run_at === null ? null : new Date(row.last_run_at).toISOString(),
          lastRunRows: row.last_run_rows ?? 0,
          nullRatePct: row.last_run_null_rate_pct
            ? Number.parseFloat(row.last_run_null_rate_pct)
            : 0,
          healsToday: Number(row.heals_today),
          openIncidentId: status === "healthy" ? null : row.incident_id,
          hasTemplate: row.has_template,
          isPullable: row.is_pullable,
        } satisfies FleetScraper,
      ];
    });
  }

  async getCollectorId(storeId: string): Promise<string | null> {
    const rows = (await this.db.execute(sql`
      select studio_collector_id from stores where store_id = ${storeId}
    `)) as unknown as { studio_collector_id: string | null }[];
    return rows[0]?.studio_collector_id ?? null;
  }

  async setCollectorId(storeId: string, collectorId: string): Promise<void> {
    await this.db.execute(sql`
      update stores set studio_collector_id = ${collectorId} where store_id = ${storeId}
    `);
  }

  async setStudioEndpoint(storeId: string, endpoint: string): Promise<void> {
    await this.db.execute(sql`
      update stores set studio_endpoint = ${endpoint} where store_id = ${storeId}
    `);
  }

  async upsertScraper(collectorId: string, name: string, targetSite: string): Promise<void> {
    await this.db.execute(sql`
      insert into scrapers (id, name, target_site, output_schema, status)
      values (${collectorId}, ${name}, ${targetSite}, '[]'::jsonb, 'healthy')
      on conflict (id) do update set name = excluded.name, target_site = excluded.target_site
    `);
  }
}

/**
 * The board shows six states; a run only knows three.
 *
 * An open incident outranks the last run, because that is the whole claim the
 * product makes: a store whose last pull looked fine but whose incident is
 * still open is not healthy. Only when nothing is open does the last run decide.
 */
function stateFor(row: FleetRow): ScraperState {
  switch (row.incident_state) {
    case "healing":
      return "healing";
    case "manual":
      return "manual_attention";
    default:
      break;
  }

  const runStatus = runStatusFromDb(row.last_run_status);
  if (runStatus === "broken") return "broken";
  if (runStatus === "suspect") return "suspect";
  // A store that has never run, or ran before the status column was populated,
  // is not evidence of breakage. An unresolved incident is.
  return row.incident_state === null ? "healthy" : "suspect";
}
