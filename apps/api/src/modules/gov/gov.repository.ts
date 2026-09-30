import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  type FuelResponse,
  type LpgResponse,
  type MarketsResponse,
  type SrpResponse,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

/** The Oil Monitor reports adjustments per fuel family, not per grade. */
export function adjustmentVariant(product: string): string {
  const p = product.toUpperCase();
  if (p.startsWith("RON")) return "gasoline";
  if (p.startsWith("DIESEL")) return "diesel";
  if (p.startsWith("KEROSENE")) return "kerosene";
  return "";
}

const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

/**
 * Reads over the government price series the collector writes. Every query is
 * scoped to one source; a source with no data yet answers empty, not 404.
 */
@Injectable()
export class GovRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async fuel(region: string, product: string): Promise<FuelResponse> {
    const [latest] = (await this.db.execute(sql`
      select max(p.period_start)::text as start, max(p.period_end)::text as "end"
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'doe_pump' and s.region = ${region}
        and p.period_start = (
          select max(p2.period_start) from gov_prices p2 join gov_series s2 on s2.id = p2.series_id
          where s2.source = 'doe_pump' and s2.region = ${region})
    `)) as unknown as { start: string | null; end: string | null }[];

    const empty: FuelResponse = {
      region,
      product,
      products: [],
      week: null,
      adjustment: null,
      cities: [],
      range: null,
      history: [],
    };
    if (!latest?.start || !latest.end) return empty;

    const products = (await this.db.execute(sql`
      select distinct s.commodity from gov_series s join gov_prices p on p.series_id = s.id
      where s.source = 'doe_pump' and s.region = ${region} and p.period_start = ${latest.start}::date
      order by 1
    `)) as unknown as { commodity: string }[];

    const rows = (await this.db.execute(sql`
      select s.place as city, s.brand, p.price_min::text as min, p.price_max::text as max
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'doe_pump' and s.region = ${region} and s.commodity = ${product}
        and p.period_start = ${latest.start}::date
      order by s.place, p.price_min, s.brand
    `)) as unknown as { city: string; brand: string; min: string; max: string }[];

    const byCity = new Map<string, FuelResponse["cities"][number]["brands"]>();
    for (const r of rows) {
      const list = byCity.get(r.city) ?? [];
      list.push({ brand: r.brand, min: num(r.min), max: num(r.max) });
      byCity.set(r.city, list);
    }

    const [adj] = (await this.db.execute(sql`
      select p.price_min::text as min, p.price_max::text as max, p.period_start::text as effective
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'doe_oil_monitor' and s.commodity = 'adjustment'
        and s.variant = ${adjustmentVariant(product)}
      order by p.period_start desc limit 1
    `)) as unknown as { min: string; max: string; effective: string }[];

    const history = (await this.db.execute(sql`
      select p.period_start::text as week_start,
             percentile_cont(0.5) within group (order by p.price_min)::text as median
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'doe_pump' and s.region = ${region} and s.commodity = ${product}
      group by p.period_start
      order by p.period_start desc
      limit 12
    `)) as unknown as { week_start: string; median: string }[];

    const all = rows.flatMap((r) => [num(r.min), num(r.max)]);
    return {
      region,
      product,
      products: products.map((p) => p.commodity),
      week: { start: latest.start, end: latest.end },
      adjustment: adj ? { min: num(adj.min), max: num(adj.max), effective: adj.effective } : null,
      cities: [...byCity].map(([city, brands]) => ({ city, brands })),
      range: all.length > 0 ? { min: Math.min(...all), max: Math.max(...all) } : null,
      history: history.reverse().map((h) => ({ weekStart: h.week_start, median: num(h.median) })),
    };
  }

  async lpg(): Promise<LpgResponse> {
    const rows = (await this.db.execute(sql`
      select p.period_start::text as month, p.price_min::text as min, p.price_max::text as max,
             s.unit
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'doe_lpg'
      order by p.period_start
    `)) as unknown as { month: string; min: string; max: string; unit: string }[];
    return {
      unit: rows[0]?.unit ?? "11-kg cylinder",
      months: rows.map((r) => ({ month: r.month, min: num(r.min), max: num(r.max) })),
    };
  }

  async markets(commodity: string | undefined): Promise<MarketsResponse> {
    const [latest] = (await this.db.execute(sql`
      select max(p.period_start)::text as d
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'bantay_presyo'
    `)) as unknown as { d: string | null }[];
    if (!latest?.d) return { date: null, commodities: [], rows: [] };

    const commodities = (await this.db.execute(sql`
      select distinct s.commodity from gov_series s join gov_prices p on p.series_id = s.id
      where s.source = 'bantay_presyo' and p.period_start = ${latest.d}::date
      order by 1
    `)) as unknown as { commodity: string }[];

    const rows = (await this.db.execute(sql`
      select s.commodity, s.variant, s.unit, s.place as market, p.price_min::text as price
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'bantay_presyo' and p.period_start = ${latest.d}::date
        and (${commodity ?? null}::text is null or s.commodity = ${commodity ?? null})
      order by s.commodity, s.variant, p.price_min
    `)) as unknown as {
      commodity: string;
      variant: string;
      unit: string;
      market: string;
      price: string;
    }[];

    const grouped = new Map<string, MarketsResponse["rows"][number]>();
    for (const r of rows) {
      const key = `${r.commodity}\u0000${r.variant}\u0000${r.unit}`;
      const row = grouped.get(key) ?? {
        commodity: r.commodity,
        variant: r.variant,
        unit: r.unit,
        markets: [],
      };
      row.markets.push({ market: r.market, price: num(r.price) });
      grouped.set(key, row);
    }
    return {
      date: latest.d,
      commodities: commodities.map((c) => c.commodity),
      rows: [...grouped.values()],
    };
  }

  async srp(q: string | undefined): Promise<SrpResponse> {
    const [latest] = (await this.db.execute(sql`
      select max(p.period_start)::text as d
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'dti_srp'
    `)) as unknown as { d: string | null }[];
    if (!latest?.d) return { effective: null, items: [] };

    const pattern = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = (await this.db.execute(sql`
      select s.commodity as category, s.variant as product, s.unit as size,
             p.price_min::text as price
      from gov_prices p join gov_series s on s.id = p.series_id
      where s.source = 'dti_srp' and p.period_start = ${latest.d}::date
        and (${pattern}::text is null or s.variant ilike ${pattern} or s.commodity ilike ${pattern})
      order by s.commodity, s.variant, s.unit
    `)) as unknown as { category: string; product: string; size: string; price: string }[];
    return {
      effective: latest.d,
      items: rows.map((r) => ({ ...r, price: num(r.price) })),
    };
  }
}
