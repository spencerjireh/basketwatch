import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { countrySchema, DEFAULT_CURRENCY_BY_COUNTRY } from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { type PriceChange } from "./diff.js";
import { type PulledRow, type PullerConfig } from "./puller.types.js";

type StoreRow = {
  store_id: string;
  country: string;
  currency: string | null;
  method: string | null;
  endpoint: string | null;
  studio_endpoint: string | null;
  max_pages: number | null;
  coverage: string | null;
  needs_browser: boolean;
  needs_unlocker: boolean;
  studio_collector_id: string | null;
};

export type RunSummary = {
  storeId: string;
  method: string;
  transport: "http" | "studio" | "unlocker";
  source: "puller" | "studio";
  trigger: "cron" | "manual";
  rows: number;
  unitPriced: number;
  pages: number;
  ceilingReached: boolean;
  changes: number;
  coverage: string | null;
  rawOutput?: unknown[];
};

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class PullersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Crawl config comes from the `stores` table, not from fleet.lock.json.
   *
   * The lock is a lab artifact and the columns already hold its `catalogue`
   * block, so changing where a store is crawled is a row edit rather than a
   * deploy. Stores with `method = 'none'` have no catalogue to pull and are
   * excluded here rather than skipped later.
   */
  async pullableStores(storeIds?: string[]): Promise<PullerConfig[]> {
    const filter =
      storeIds && storeIds.length > 0
        ? sql`and s.store_id in (${sql.join(
            storeIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql``;

    const rows = (await this.db.execute(sql`
      select s.store_id, s.country, s.currency, s.method, s.endpoint, s.studio_endpoint,
             s.max_pages, s.coverage, s.needs_browser, s.needs_unlocker, s.studio_collector_id
      from stores s
      where s.method is not null and s.method <> 'none' ${filter}
      order by s.store_id
    `)) as unknown as StoreRow[];

    return rows.flatMap((row) => {
      const country = countrySchema.safeParse(row.country);
      if (!country.success) return [];
      return [
        {
          storeId: row.store_id,
          country: country.data,
          currency: row.currency ?? DEFAULT_CURRENCY_BY_COUNTRY[country.data],
          method: row.method!,
          endpoint: row.endpoint,
          studioEndpoint: row.studio_endpoint,
          maxPages: row.max_pages ?? 0,
          needsBrowser: row.needs_browser,
          needsUnlocker: row.needs_unlocker,
          collectorId: row.studio_collector_id,
        } satisfies PullerConfig,
      ];
    });
  }

  /** The last known price per product, which is what `diff` compares against. */
  async latestPrices(storeId: string): Promise<Map<string, number>> {
    const rows = (await this.db.execute(sql`
      select product_key, price::text as price
      from latest_price
      where store_id = ${storeId}
    `)) as unknown as { product_key: string; price: string }[];

    return new Map(rows.map((row) => [row.product_key, Number.parseFloat(row.price)]));
  }

  async storeHasHistory(storeId: string): Promise<boolean> {
    const [row] = (await this.db.execute(sql`
      select exists (select 1 from price_observations where store_id = ${storeId}) as has
    `)) as unknown as { has: boolean }[];
    return row?.has ?? false;
  }

  /**
   * Everything one pull writes, in one transaction.
   *
   * The run row is written unconditionally, even at zero changes and even when
   * the observations are suppressed. That is the invariant the whole history
   * rests on: a change-only history without per-run summaries cannot tell a
   * truncated pull from a genuine day of stable prices.
   */
  async recordRun(
    summary: RunSummary,
    products: PulledRow[],
    changes: PriceChange[],
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rawJson = summary.rawOutput ? JSON.stringify(summary.rawOutput) : null;
      const [run] = (await tx.execute(sql`
        insert into runs (store_id, at, method, transport, source, trigger, status,
                          rows, unit_priced, pages, ceiling_reached, changes, coverage, raw_output)
        values (${summary.storeId}, now(), ${summary.method}, ${summary.transport},
                ${summary.source}, ${summary.trigger}, 'ok', ${summary.rows},
                ${summary.unitPriced}, ${summary.pages}, ${summary.ceilingReached},
                ${summary.changes}, ${summary.coverage},
                ${rawJson ? sql`${rawJson}::jsonb` : sql`null`})
        returning id
      `)) as unknown as { id: string }[];
      const runId = Number(run!.id);

      for (const batch of chunk(products, 500)) {
        await tx.execute(sql`
          insert into products (store_id, product_key, name, url, category, unit,
                                size_value, size_uom, size_quantity, size_base_uom,
                                size_form, size_approximate, first_seen, last_seen)
          values ${sql.join(
            batch.map(
              (p) => sql`(${p.storeId}, ${p.productKey}, ${p.name}, ${p.url}, ${p.category},
                          ${p.size?.raw ?? null}, ${p.size?.value ?? null}, ${p.size?.uom ?? null},
                          ${p.size?.quantity ?? null}, ${p.size?.baseUom ?? null},
                          ${p.size?.form ?? null}, ${p.size?.approximate ?? false},
                          ${p.observedAt}::timestamptz, ${p.observedAt}::timestamptz)`,
            ),
            sql`, `,
          )}
          on conflict (store_id, product_key) do update set
            name = excluded.name,
            url = excluded.url,
            category = excluded.category,
            unit = excluded.unit,
            size_value = excluded.size_value,
            size_uom = excluded.size_uom,
            size_quantity = excluded.size_quantity,
            size_base_uom = excluded.size_base_uom,
            size_form = excluded.size_form,
            size_approximate = excluded.size_approximate,
            -- first_seen is the product's own age and must survive every later
            -- pull; only last_seen moves.
            last_seen = excluded.last_seen
        `);
      }

      for (const batch of chunk(changes, 500)) {
        await tx.execute(sql`
          insert into price_observations (run_id, store_id, product_key, observed_at, price,
                                          currency, unit_price, unit_price_basis, in_stock,
                                          source, change, previous_price, delta)
          values ${sql.join(
            batch.map(
              (c) => sql`(${runId}, ${c.storeId}, ${c.productKey}, ${c.observedAt}::timestamptz,
                          ${c.price}, ${c.currency}, ${c.unitPrice?.value ?? null},
                          ${c.unitPrice?.basis ?? null}, ${c.inStock}, ${c.source},
                          ${c.change}, ${c.previousPrice}, ${c.delta})`,
            ),
            sql`, `,
          )}
        `);
      }

      return runId;
    });
  }

  /** A run with no rows to apply still needs its summary row. */
  async recordEmptyRun(summary: RunSummary): Promise<number> {
    const rawJson = summary.rawOutput ? JSON.stringify(summary.rawOutput) : null;
    const [run] = (await this.db.execute(sql`
      insert into runs (store_id, at, method, transport, source, trigger, status,
                        rows, unit_priced, pages, ceiling_reached, changes, coverage, raw_output)
      values (${summary.storeId}, now(), ${summary.method}, ${summary.transport},
              ${summary.source}, ${summary.trigger}, ${summary.rows === 0 ? "error" : "anomalous"},
              ${summary.rows}, ${summary.unitPriced}, ${summary.pages},
              ${summary.ceilingReached}, ${summary.changes}, ${summary.coverage},
              ${rawJson ? sql`${rawJson}::jsonb` : sql`null`})
      returning id
    `)) as unknown as { id: string }[];
    return Number(run!.id);
  }

  /**
   * Is a pull for this store already waiting or running?
   *
   * pg-boss's `singletonKey` looks like it should answer this, and does not:
   * the unique index that enforces it is only created for queues whose policy
   * is `stately` or `short`, and ours are created with the default `standard`
   * policy. The key is stored and ignored. `updateQueue` cannot change a
   * policy after the fact, so this asks the question directly instead.
   *
   * Two requests in the same millisecond can still both pass. That is a race
   * worth losing: the cost is one redundant pull, and the worker takes one job
   * at a time, so they cannot overlap and corrupt each other's writes.
   */
  async hasPendingPull(storeId: string): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      select 1 from pgboss.job
      where name = 'scrape-run'
        and state in ('created', 'retry', 'active')
        and data->>'storeId' = ${storeId}
      limit 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  }

  /**
   * Store-scoped and kind-agnostic, matching the validator's rule exactly: one
   * open incident per store suppresses the next. A repeatedly failing store
   * would otherwise stack a fresh incident, and a fresh heal, on every run.
   */
  async hasOpenIncident(storeId: string): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      select 1 from incidents
      where store_id = ${storeId} and state in ('open', 'healing')
      limit 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  }

  async openIncident(
    storeId: string,
    runId: number,
    kind: string,
    evidence: Record<string, unknown>,
    scraperId?: string | null,
  ): Promise<string> {
    const rows = (await this.db.execute(sql`
      insert into incidents (store_id, scraper_id, run_id, kind, evidence, state)
      values (${storeId}, ${scraperId ?? null}, ${runId}, ${kind}, ${JSON.stringify(evidence)}::jsonb, 'open')
      returning id::text
    `)) as unknown as { id: string }[];
    return rows[0]!.id;
  }
}

/** Postgres caps a statement at 65,535 parameters; 500 rows keeps well inside it. */
function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
