import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { type Baseline } from "./checks.types.js";

interface ProductRow {
  product_key: string;
  name: string | null;
  url: string | null;
  category: string | null;
  unit: string | null;
  size_value: number | null;
  size_uom: string | null;
  price: string | null;
  currency: string | null;
  in_stock: boolean | null;
}

interface BaselineRow {
  store_id: string;
  field_null_rates: string;
  expected_row_count: number;
  value_ranges: string;
}

@Injectable()
export class ValidatorRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async loadBaseline(storeId: string): Promise<Baseline | null> {
    const rows = (await this.db.execute(sql`
      select store_id, field_null_rates::text, expected_row_count, value_ranges::text
      from baselines
      where store_id = ${storeId}
    `)) as unknown as BaselineRow[];

    if (!rows[0]) return null;
    return {
      fieldNullRates: JSON.parse(rows[0].field_null_rates) as Record<string, number>,
      expectedRowCount: rows[0].expected_row_count,
      valueRanges: JSON.parse(rows[0].value_ranges) as Record<string, [number, number]>,
    };
  }

  /**
   * Load the current products for a store, joined with their latest price.
   * This is what the validator checks run against.
   */
  async loadStoreProducts(storeId: string): Promise<Record<string, unknown>[]> {
    const rows = (await this.db.execute(sql`
      select
        p.product_key,
        p.name,
        p.url,
        p.category,
        p.unit,
        p.size_value,
        p.size_uom,
        lp.price::text as price,
        lp.currency,
        lp.in_stock
      from products p
      left join latest_price lp
        on lp.store_id = p.store_id and lp.product_key = p.product_key
      where p.store_id = ${storeId}
    `)) as unknown as ProductRow[];

    return rows.map((r) => ({
      product_key: r.product_key,
      name: r.name,
      url: r.url,
      category: r.category,
      unit: r.unit,
      size_value: r.size_value,
      size_uom: r.size_uom,
      price: r.price ? Number.parseFloat(r.price) : null,
      currency: r.currency,
      in_stock: r.in_stock,
    }));
  }

  async updateRunFindings(
    runId: number,
    findings: unknown,
    nullRatePct: number,
    status: string,
  ): Promise<void> {
    await this.db.execute(sql`
      update runs
      set findings = ${JSON.stringify(findings)}::jsonb,
          null_rate_pct = ${nullRatePct},
          status = ${status}
      where id = ${runId}
    `);
  }

  async loadRunRawOutput(runId: number): Promise<unknown[]> {
    const rows = (await this.db.execute(sql`
      select raw_output::text from runs where id = ${runId}
    `)) as unknown as { raw_output: string | null }[];
    if (!rows[0]?.raw_output) return [];
    try {
      const parsed = JSON.parse(rows[0].raw_output);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async getScraperId(storeId: string): Promise<string | null> {
    const rows = (await this.db.execute(sql`
      select studio_collector_id from stores where store_id = ${storeId}
    `)) as unknown as { studio_collector_id: string | null }[];
    return rows[0]?.studio_collector_id ?? null;
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

  async hasOpenIncident(storeId: string): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      select 1 from incidents
      where store_id = ${storeId} and state in ('open', 'healing')
      limit 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  }

  /**
   * Compute a baseline from the current products table and store it.
   * Uses the products + latest_price view to calculate field null rates,
   * expected row count, and p5/p95 price ranges.
   */
  async computeAndSeedBaseline(storeId: string): Promise<Baseline> {
    const products = await this.loadStoreProducts(storeId);
    if (products.length === 0) {
      return { fieldNullRates: {}, expectedRowCount: 0, valueRanges: {} };
    }

    const fields = ["name", "url", "price", "currency", "in_stock", "size_value", "size_uom"];
    const fieldNullRates: Record<string, number> = {};
    for (const field of fields) {
      const nullCount = products.filter((p) => {
        const v = p[field];
        return v === null || v === undefined || v === "";
      }).length;
      fieldNullRates[field] = nullCount / products.length;
    }

    const prices = products
      .map((p) => p.price as number | null)
      .filter((p): p is number => typeof p === "number" && !Number.isNaN(p))
      .sort((a, b) => a - b);

    const valueRanges: Record<string, [number, number]> = {};
    if (prices.length > 0) {
      const p5 = prices[Math.floor(prices.length * 0.05)]!;
      const p95 = prices[Math.ceil(prices.length * 0.95) - 1]!;
      valueRanges.price = [p5, p95];
    }

    const baseline: Baseline = {
      fieldNullRates,
      expectedRowCount: products.length,
      valueRanges,
    };

    await this.db.execute(sql`
      insert into baselines (store_id, field_null_rates, expected_row_count, value_ranges, updated_at)
      values (
        ${storeId},
        ${JSON.stringify(baseline.fieldNullRates)}::jsonb,
        ${baseline.expectedRowCount},
        ${JSON.stringify(baseline.valueRanges)}::jsonb,
        now()
      )
      on conflict (store_id) do update set
        field_null_rates = excluded.field_null_rates,
        expected_row_count = excluded.expected_row_count,
        value_ranges = excluded.value_ranges,
        updated_at = excluded.updated_at
    `);

    return baseline;
  }

  /** The recorded size and null rate of one run, for canary outcomes. */
  async getRunStats(runId: number): Promise<{ rows: number; nullRatePct: number } | null> {
    const result = (await this.db.execute(sql`
      select rows, null_rate_pct from runs where id = ${runId}
    `)) as unknown as { rows: number; null_rate_pct: string | number | null }[];
    if (!result[0]) return null;
    return {
      rows: Number(result[0].rows ?? 0),
      nullRatePct: Number(result[0].null_rate_pct ?? 0),
    };
  }

  /** Seed baselines for all stores that have products. */
  async seedAllBaselines(): Promise<number> {
    const storeRows = (await this.db.execute(sql`
      select distinct store_id from products
    `)) as unknown as { store_id: string }[];

    let count = 0;
    for (const row of storeRows) {
      await this.computeAndSeedBaseline(row.store_id);
      count++;
    }
    return count;
  }
}
