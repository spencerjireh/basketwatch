import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

// ---------------------------------------------------------------------------
// Row shapes returned by raw SQL
// ---------------------------------------------------------------------------

export interface ScraperStoreRow {
  scraper_id: string;
  scraper_name: string;
  target_site: string;
  store_id: string | null;
  store_name: string | null;
  store_endpoint: string | null;
}

interface IncidentRow {
  id: string;
  kind: string;
  evidence: string;
  state: string;
}

interface AttemptIdRow {
  id: string;
}

interface CountRow {
  n: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class HealRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Look up a scraper and its associated store. */
  async findScraperWithStore(scraperId: string): Promise<ScraperStoreRow | null> {
    const rows = (await this.db.execute(sql`
      select
        sc.id        as scraper_id,
        sc.name      as scraper_name,
        sc.target_site,
        st.store_id,
        st.name      as store_name,
        st.endpoint  as store_endpoint
      from scrapers sc
      left join stores st on st.studio_collector_id = sc.id
      where sc.id = ${scraperId}
      limit 1
    `)) as unknown as ScraperStoreRow[];

    return rows[0] ?? null;
  }

  /** Find the latest open/healing incident for this scraper. */
  async findOpenIncident(scraperId: string): Promise<{
    id: string;
    kind: string;
    evidence: Record<string, unknown>;
    state: string;
  } | null> {
    const rows = (await this.db.execute(sql`
      select id::text, kind, evidence::text, state
      from incidents
      where scraper_id = ${scraperId}
        and state in ('open', 'healing')
      order by opened_at desc
      limit 1
    `)) as unknown as IncidentRow[];

    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      kind: rows[0].kind,
      evidence: JSON.parse(rows[0].evidence) as Record<string, unknown>,
      state: rows[0].state,
    };
  }

  /**
   * Create an incident to track this heal attempt. Every heal_attempt needs an
   * incident_id (NOT NULL FK), so manual triggers create one on the fly.
   */
  async createIncident(
    scraperId: string,
    storeId: string | null,
    kind: string,
    evidence: Record<string, unknown>,
  ): Promise<string> {
    const rows = (await this.db.execute(sql`
      insert into incidents (scraper_id, store_id, kind, evidence, state)
      values (${scraperId}, ${storeId}, ${kind}, ${JSON.stringify(evidence)}::jsonb, 'healing')
      returning id::text
    `)) as unknown as AttemptIdRow[];

    return rows[0]!.id;
  }

  /** Set incident state to 'healing'. */
  async markIncidentHealing(incidentId: string): Promise<void> {
    await this.db.execute(sql`
      update incidents set state = 'healing' where id = ${incidentId}::uuid
    `);
  }

  /** Record the start of a heal attempt. Returns the attempt ID. */
  async recordAttempt(
    incidentId: string,
    attempt: number,
    diagnosis: string,
    prompt: string,
  ): Promise<string> {
    const rows = (await this.db.execute(sql`
      insert into heal_attempts (incident_id, attempt, started_at, claude_diagnosis, heal_prompt)
      values (${incidentId}::uuid, ${attempt}, now(), ${diagnosis}, ${prompt})
      returning id::text
    `)) as unknown as AttemptIdRow[];

    return rows[0]!.id;
  }

  /**
   * Set the attempt's verdict -- but only if nobody has set one yet.
   *
   * Two writers race here by design: the dashboard's status poll (which fails
   * an attempt when Bright Data reports error/done) and the auto-approve poll
   * worker. Whoever claims first wins, and every side effect -- resolve,
   * reopen, hold, template save, canary enqueue, re-propose -- must run only
   * on a won claim. COALESCE keeps a diff that an earlier poll persisted:
   * the old unconditional update was nulling the diff approve() had just
   * saved.
   */
  async claimVerdict(
    attemptId: string,
    verdict: string,
    studioDiff: string | null,
  ): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      update heal_attempts
      set finished_at = now(),
          verdict = ${verdict},
          studio_diff = coalesce(${studioDiff}, studio_diff)
      where id = ${attemptId}::uuid and verdict is null
      returning id::text
    `)) as unknown as AttemptIdRow[];
    return rows.length > 0;
  }

  /** The attempt's verdict, incident and owners, for poll ticks and canary outcomes. */
  async getAttempt(attemptId: string): Promise<{
    verdict: string | null;
    incidentId: string;
    scraperId: string;
    storeId: string | null;
  } | null> {
    const rows = (await this.db.execute(sql`
      select ha.verdict, ha.incident_id::text as incident_id, i.scraper_id, i.store_id
      from heal_attempts ha
      join incidents i on i.id = ha.incident_id
      where ha.id = ${attemptId}::uuid
    `)) as unknown as {
      verdict: string | null;
      incident_id: string;
      scraper_id: string;
      store_id: string | null;
    }[];
    if (!rows[0]) return null;
    return {
      verdict: rows[0].verdict,
      incidentId: rows[0].incident_id,
      scraperId: rows[0].scraper_id,
      storeId: rows[0].store_id,
    };
  }

  /** Store the verification-pull result on the attempt. */
  async updateAttemptCanary(attemptId: string, canaryJson: string): Promise<void> {
    await this.db.execute(sql`
      update heal_attempts
      set canary = ${canaryJson}::jsonb
      where id = ${attemptId}::uuid
    `);
  }

  /**
   * Hold an incident for a person: the machine is out of proposals (or out of
   * its depth). 'manual' is already in the contract's incidentStates.
   */
  async markIncidentManual(incidentId: string): Promise<void> {
    await this.db.execute(sql`
      update incidents set state = 'manual'
      where id = ${incidentId}::uuid and state in ('open', 'healing')
    `);
  }

  /**
   * Every attempt still awaiting a verdict, for the boot sweep: a restart (or
   * a proposal made before the poll loop existed) must not orphan a heal that
   * Bright Data is still holding open.
   */
  async listPendingAttempts(): Promise<{
    attemptId: string;
    incidentId: string;
    scraperId: string;
    storeId: string | null;
  }[]> {
    const rows = (await this.db.execute(sql`
      select
        ha.id::text          as attempt_id,
        ha.incident_id::text as incident_id,
        i.scraper_id,
        i.store_id
      from heal_attempts ha
      join incidents i on i.id = ha.incident_id
      where ha.verdict is null
      order by ha.started_at asc
    `)) as unknown as {
      attempt_id: string;
      incident_id: string;
      scraper_id: string;
      store_id: string | null;
    }[];
    return rows.map((r) => ({
      attemptId: r.attempt_id,
      incidentId: r.incident_id,
      scraperId: r.scraper_id,
      storeId: r.store_id,
    }));
  }

  /** Count today's heal attempts for budget checks. */
  async todaysHealCount(scraperId: string): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::text as n
      from heal_attempts ha
      join incidents i on i.id = ha.incident_id
      where i.scraper_id = ${scraperId}
        and ha.started_at >= current_date
    `)) as unknown as CountRow[];

    return Number(rows[0]?.n ?? 0);
  }

  /** Mark the latest open incident as resolved. */
  async resolveIncident(incidentId: string): Promise<void> {
    await this.db.execute(sql`
      update incidents
      set state = 'resolved', resolved_at = now()
      where id = ${incidentId}::uuid
    `);
  }

  /** Revert an incident from 'healing' back to 'open' (e.g. after a failed attempt). */
  async reopenIncident(incidentId: string): Promise<void> {
    await this.db.execute(sql`
      update incidents set state = 'open'
      where id = ${incidentId}::uuid and state = 'healing'
    `);
  }

  /** Count of previous attempts on this incident (for the attempt number). */
  async attemptCount(incidentId: string): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::text as n
      from heal_attempts
      where incident_id = ${incidentId}::uuid
    `)) as unknown as CountRow[];

    return Number(rows[0]?.n ?? 0);
  }

  /** Find the latest pending (no verdict) attempt for a scraper. */
  async findPendingAttempt(scraperId: string): Promise<{
    attemptId: string;
    incidentId: string;
  } | null> {
    const rows = (await this.db.execute(sql`
      select ha.id::text as attempt_id, ha.incident_id::text as incident_id
      from heal_attempts ha
      join incidents i on i.id = ha.incident_id
      where i.scraper_id = ${scraperId}
        and ha.verdict is null
      order by ha.started_at desc
      limit 1
    `)) as unknown as { attempt_id: string; incident_id: string }[];

    if (!rows[0]) return null;
    return { attemptId: rows[0].attempt_id, incidentId: rows[0].incident_id };
  }

  /** Like findPendingAttempt but also returns started_at for timing. */
  async findPendingAttemptWithTiming(scraperId: string): Promise<{
    attemptId: string;
    incidentId: string;
    startedAt: string;
  } | null> {
    const rows = (await this.db.execute(sql`
      select
        ha.id::text as attempt_id,
        ha.incident_id::text as incident_id,
        ha.started_at::text as started_at
      from heal_attempts ha
      join incidents i on i.id = ha.incident_id
      where i.scraper_id = ${scraperId}
        and ha.verdict is null
      order by ha.started_at desc
      limit 1
    `)) as unknown as { attempt_id: string; incident_id: string; started_at: string }[];

    if (!rows[0]) return null;
    return {
      attemptId: rows[0].attempt_id,
      incidentId: rows[0].incident_id,
      startedAt: rows[0].started_at,
    };
  }

  /** Find the open/healing incident with full detail including opened_at. */
  async findOpenIncidentFull(scraperId: string): Promise<{
    id: string;
    kind: string;
    evidence: Record<string, unknown>;
    state: string;
    openedAt: string;
  } | null> {
    const rows = (await this.db.execute(sql`
      select id::text, kind, evidence::text, state, opened_at::text as opened_at
      from incidents
      where scraper_id = ${scraperId}
        and state in ('open', 'healing')
      order by opened_at desc
      limit 1
    `)) as unknown as (IncidentRow & { opened_at: string })[];

    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      kind: rows[0].kind,
      evidence: JSON.parse(rows[0].evidence) as Record<string, unknown>,
      state: rows[0].state,
      openedAt: rows[0].opened_at,
    };
  }

  /** Update only the studio_diff on an in-flight attempt (before verdict). */
  async updateAttemptDiff(attemptId: string, studioDiff: string): Promise<void> {
    await this.db.execute(sql`
      update heal_attempts
      set studio_diff = ${studioDiff}
      where id = ${attemptId}::uuid
    `);
  }

  /** Read the stored diff from a heal attempt. */
  async getAttemptDiff(attemptId: string): Promise<string | null> {
    const rows = (await this.db.execute(sql`
      select studio_diff from heal_attempts where id = ${attemptId}::uuid
    `)) as unknown as { studio_diff: string | null }[];
    return rows[0]?.studio_diff ?? null;
  }

  // -----------------------------------------------------------------------
  // Scraper templates
  // -----------------------------------------------------------------------

  /** Save a scraper template snapshot. */
  async saveTemplate(
    scraperId: string,
    templateJson: unknown,
    source: string,
    healAttemptId?: string,
  ): Promise<string> {
    const rows = (await this.db.execute(sql`
      insert into scraper_templates (scraper_id, template_json, source, heal_attempt_id)
      values (
        ${scraperId},
        ${JSON.stringify(templateJson)}::jsonb,
        ${source},
        ${healAttemptId ?? null}${healAttemptId ? sql`::uuid` : sql``}
      )
      returning id::text
    `)) as unknown as AttemptIdRow[];
    return rows[0]!.id;
  }

  /** Get the latest template for a scraper. */
  async getLatestTemplate(scraperId: string): Promise<unknown | null> {
    const rows = (await this.db.execute(sql`
      select template_json
      from scraper_templates
      where scraper_id = ${scraperId}
      order by captured_at desc
      limit 1
    `)) as unknown as { template_json: unknown }[];
    return rows[0]?.template_json ?? null;
  }

  /** List scraper IDs that have a studio_collector_id but no template row. */
  async findScrapersWithoutTemplate(): Promise<string[]> {
    const rows = (await this.db.execute(sql`
      select s.studio_collector_id as id
      from stores s
      where s.studio_collector_id is not null
        and s.studio_collector_id not in (
          select distinct scraper_id from scraper_templates
        )
    `)) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  }
}
