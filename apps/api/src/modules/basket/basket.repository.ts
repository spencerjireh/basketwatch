import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  DEFAULT_CURRENCY_BY_COUNTRY,
  countrySchema,
  type BasketItem,
  type BasketPoint,
  type BasketSeries,
  type Country,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { toMoney } from "../../database/mappers/money.mapper.js";

/**
 * Which pins count towards the published index.
 *
 * Three filters, and each one is a decision rather than a convenience:
 * `status` keeps unresolved and out-of-stock pins out, `index_contributor`
 * keeps a store the team has not endorsed from moving the headline number, and
 * `tier = 'core'` fixes the basket at the ten staples the PRD names. Widening
 * any of them changes what the chart means, so they live in one place.
 */
const PIN_FILTER = sql`
  b.status in ('verified', 'curated')
  and b.product_key is not null
  and s.index_contributor
  and i.tier = 'core'
`;

type TodayRow = {
  item_key: string;
  label: string;
  country: string;
  unit: string | null;
  store_id: string;
  store_name: string;
  price: string;
  currency: string;
  unit_price: string | null;
  unit_price_basis: string | null;
  previous_price: string | null;
  delta: string | null;
};

type IndexRow = {
  d: string;
  country: string;
  items: string;
  total: string | null;
};

type IncidentRow = {
  id: string;
  country: string;
  opened_at: string;
  resolved_at: string | null;
};

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class BasketRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** One series per country; a day with no trustworthy data yields a null total. */
  async indexSeries(country?: Country): Promise<BasketSeries[]> {
    // Change-only history means a day's price is the last observation at or
    // before that day, not a row dated that day -- hence the as-of join rather
    // than a group-by on observed_at. The series starts at the first
    // observation we hold: days before tracking began are not gaps, they are
    // days we make no claim about, and drawing them as outages would be a lie
    // in the other direction.
    const rows = (await this.db.execute(sql`
      with pins as (
        select b.item_key, b.store_id, b.product_key, s.country
        from basket_map b
        join stores s on s.store_id = b.store_id
        join items i on i.key = b.item_key
        where ${PIN_FILTER}
          and (${country ?? null}::text is null or s.country = ${country ?? null})
      ),
      obs as (
        select p.country, p.item_key, p.store_id, p.product_key,
               o.observed_at::date as d, o.price, o.id
        from pins p
        join price_observations o
          on o.store_id = p.store_id and o.product_key = p.product_key
      ),
      days as (
        select generate_series((select min(d) from obs), current_date, interval '1 day')::date as d
      ),
      as_of as (
        select distinct on (days.d, obs.country, obs.item_key, obs.store_id, obs.product_key)
               days.d, obs.country, obs.item_key, obs.price
        from days
        join obs on obs.d <= days.d
        order by days.d, obs.country, obs.item_key, obs.store_id, obs.product_key, obs.id desc
      ),
      cheapest as (
        select d, country, item_key, min(price) as price
        from as_of
        group by 1, 2, 3
      )
      select d::text as d, country, count(*)::text as items, sum(price)::text as total
      from cheapest
      group by 1, 2
      order by country, d
    `)) as unknown as IndexRow[];

    const coreCount = await this.coreItemCount();
    const incidents = await this.contributingIncidents(country);
    const byCountry = new Map<Country, BasketPoint[]>();

    for (const row of rows) {
      const parsed = countrySchema.safeParse(row.country);
      if (!parsed.success) continue;

      // The null is the product. A partial basket is not a cheaper basket, so
      // a day missing any core item scores no total at all and the chart draws
      // the gap rather than interpolating across it.
      const complete = Number(row.items) === coreCount;
      const points = byCountry.get(parsed.data) ?? [];
      points.push({
        date: row.d,
        total: complete && row.total !== null ? Number(row.total) : null,
      });
      byCountry.set(parsed.data, points);
    }

    return [...byCountry].map(([seriesCountry, points]) => ({
      country: seriesCountry,
      currency: DEFAULT_CURRENCY_BY_COUNTRY[seriesCountry],
      points: annotate(points, incidents.filter((i) => i.country === seriesCountry)),
    }));
  }

  /** Cheapest pin per canonical item: basket_map joined through latest_price. */
  async today(country?: Country): Promise<BasketItem[]> {
    const rows = (await this.db.execute(sql`
      select distinct on (s.country, b.item_key)
        b.item_key,
        i.label,
        s.country,
        coalesce(b.target_size, i.target_size ->> s.country) as unit,
        b.store_id,
        s.name as store_name,
        lp.price::text as price,
        lp.currency,
        lp.unit_price::text as unit_price,
        lp.unit_price_basis,
        lp.previous_price::text as previous_price,
        lp.delta::text as delta
      from basket_map b
      join stores s on s.store_id = b.store_id
      join items i on i.key = b.item_key
      join latest_price lp
        on lp.store_id = b.store_id and lp.product_key = b.product_key
      where ${PIN_FILTER}
        and (${country ?? null}::text is null or s.country = ${country ?? null})
      order by s.country, b.item_key, lp.price asc
    `)) as unknown as TodayRow[];

    return rows.flatMap((row) => {
      const parsed = countrySchema.safeParse(row.country);
      if (!parsed.success) return [];

      const currency = row.currency || DEFAULT_CURRENCY_BY_COUNTRY[parsed.data];
      const price = toMoney(row.price, currency);
      if (!price) return [];

      return [
        {
          itemKey: row.item_key,
          label: row.label,
          unit: row.unit ?? "",
          country: parsed.data,
          cheapestStoreId: row.store_id,
          cheapestStoreName: row.store_name,
          price,
          unitPrice: toMoney(row.unit_price, currency),
          unitPriceBasis: row.unit_price_basis,
          deltaPct: deltaPct(row.delta, row.previous_price),
        } satisfies BasketItem,
      ];
    });
  }

  /** How many items a complete basket needs. Data, not a constant, so adding an item is a row edit. */
  private async coreItemCount(): Promise<number> {
    const [row] = (await this.db.execute(
      sql`select count(*)::text as n from items where tier = 'core'`,
    )) as unknown as { n: string }[];
    return Number(row?.n ?? 0);
  }

  /** Incidents on index-contributing stores, so a gap can name what caused it. */
  private async contributingIncidents(country?: Country): Promise<IncidentRow[]> {
    return (await this.db.execute(sql`
      select inc.id::text as id, s.country,
             inc.opened_at::date::text as opened_at,
             inc.resolved_at::date::text as resolved_at
      from incidents inc
      join stores s on s.store_id = inc.store_id
      where s.index_contributor
        and (${country ?? null}::text is null or s.country = ${country ?? null})
      order by inc.opened_at
    `)) as unknown as IncidentRow[];
  }
}

/**
 * Attach the incident that explains each gap, and mark the day a gap closed.
 *
 * The chart reads both: `incidentId` labels the hatched span, `healed` puts a
 * marker where the line resumes. Neither is invented -- a gap with no matching
 * incident stays unlabelled rather than being blamed on the nearest one.
 */
function annotate(points: BasketPoint[], incidents: IncidentRow[]): BasketPoint[] {
  return points.map((point, index) => {
    if (point.total === null) {
      const open = incidents.filter(
        (i) => i.opened_at <= point.date && (i.resolved_at === null || i.resolved_at >= point.date),
      );
      return { ...point, incidentId: open.at(-1)?.id ?? null };
    }

    const previous = points[index - 1];
    if (!previous || previous.total !== null) return point;

    const closed = incidents.some(
      (i) => i.resolved_at !== null && i.resolved_at > previous.date && i.resolved_at <= point.date,
    );
    return closed ? { ...point, healed: true } : point;
  });
}

/** Percent move against the previous observation; 0 means unchanged or first seen. */
function deltaPct(delta: string | null, previousPrice: string | null): number {
  if (delta === null || previousPrice === null) return 0;
  const previous = Number.parseFloat(previousPrice);
  if (!Number.isFinite(previous) || previous === 0) return 0;
  const moved = Number.parseFloat(delta);
  if (!Number.isFinite(moved)) return 0;
  return (moved / previous) * 100;
}
