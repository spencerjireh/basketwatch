import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  DEFAULT_CURRENCY_BY_COUNTRY,
  countrySchema,
  type BasketItem,
  type BasketPoint,
  type BasketSeries,
  type Country,
  type Rail,
  type RailFlag,
  type RailPin,
  type StoreSeries,
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
 * `tier = 'core'` fixes the basket at the fifteen core staples. Widening
 * any of them changes what the chart means, so they live in one place.
 */
const PIN_FILTER = sql`
  b.status in ('verified', 'curated')
  and b.product_key is not null
  and s.index_contributor
  and i.tier = 'core'
`;

/**
 * The basis an item's prices have to be quoted in to enter its comparison.
 *
 * A guard rather than a filter: no core pin in the database is currently
 * mismatched. It is what stops a chicken priced per item from being summed
 * into a per-kilo basket after some future pull parses a size differently.
 */
const WANT_BASIS = sql`
  case i.normal_unit when 'g' then 'per_kg' when 'ml' then 'per_litre' else 'per_item' end
`;

/**
 * The median unit price per item, and how many pins went into it.
 *
 * Expects a `pins` CTE exposing country, item_key, unit_price, unit_price_basis
 * and want_basis. Only comparable pins are counted: a per-item price inside a
 * per-kilo population would drag the outlier threshold somewhere meaningless.
 *
 * percentile_cont takes and returns double precision, so both casts are
 * required. percentile_disc would avoid them but with an even pin count it
 * picks the lower middle, which biases the median down and makes the outlier
 * gate more aggressive -- a real difference at four pins.
 */
const MEDIAN = sql`
  select country, item_key,
         (percentile_cont(0.5) within group (order by unit_price::float8))::numeric
           as median_unit_price,
         count(unit_price) as priced
  from pins
  where unit_price is not null and unit_price_basis = want_basis
  group by 1, 2
`;

/*
 * The three ways a pin can be disqualified, and the one way it can be merely
 * fuzzy. Every one is wrapped in coalesce: `unit_price > 10 * median` is NULL
 * rather than false when the pin has no price, and a bare `not suspect` on a
 * NULL silently drops the row -- harmless in the index, fatal on a rail whose
 * whole job is to show the pin and say what is wrong with it.
 *
 * All of these expect a pins alias `p` and a median alias `m`.
 */
const NO_SIZE = sql`coalesce(p.size_quantity is null, false)`;
const BASIS_MISMATCH = sql`
  coalesce(p.unit_price is not null and p.unit_price_basis <> p.want_basis, false)
`;
const PRICE_OUTLIER = sql`
  coalesce(m.priced >= 3 and p.unit_price > 10 * m.median_unit_price, false)
`;

/**
 * Not this item at all: a wholesale case price standing in for a retail one, a
 * bouillon cube pinned as chicken. Excluded from the index and from the
 * cheapest and dearest labels.
 *
 * Resolved once against the latest price and then held constant across all of
 * history. That is deliberate and should not be "fixed" into a per-day verdict:
 * a mispin was a mispin last Tuesday too, and recomputing it daily would make
 * the index jitter as the median moves under it.
 */
const SUSPECT = sql`(${NO_SIZE} or ${BASIS_MISMATCH} or ${PRICE_OUTLIER})`;

/**
 * The size is real but fuzzy. Still counts, and that is not softness: the only
 * Philippine banana pin we hold is a 740g-750g range, and disqualifying ranges
 * would drop the bananas line and null the whole PH basket on every day of the
 * chart.
 */
const IMPRECISE = sql`
  coalesce(p.size_approximate or p.size_form in ('multipack', 'range'), false)
`;

type TodayRow = {
  item_key: string;
  label: string;
  country: string;
  unit: string | null;
  store_id: string;
  store_name: string;
  product_name: string;
  price: string;
  currency: string;
  unit_price: string | null;
  unit_price_basis: string | null;
  index_quantity: string | null;
  index_uom: string | null;
  index_contribution: string | null;
  imprecise: boolean;
  previous_price: string | null;
  delta: string | null;
};

type IndexRow = {
  d: string;
  country: string;
  /* null on basket rows; a store id marks a row of that store's own sum */
  store_id: string | null;
  store_name: string | null;
  priced: string;
  expected: string;
  missing: string[];
  total: string | null;
};

/** One store-day off the wire, before densifying against the calendar. */
export type StoreDayRow = {
  store_id: string;
  store_name: string;
  d: string;
  priced: string;
  expected: string;
  total: string | null;
};

type RailRow = {
  country: string;
  item_key: string;
  label: string;
  index_quantity: string | null;
  index_uom: string | null;
  store_id: string;
  store_name: string;
  index_contributor: boolean;
  product_key: string;
  product_name: string;
  price: string | null;
  currency: string | null;
  unit_price: string | null;
  unit_price_basis: string | null;
  median_unit_price: string | null;
  priced: string | null;
  flag: RailFlag;
  flag_reason: string | null;
  cheapest: boolean;
  dearest: boolean;
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
    //
    // The total is a sum of unit prices multiplied out to a fixed quantity, not
    // a sum of sticker prices. Summing stickers adds a 450g loaf to a 50g
    // coffee sachet to a kilo of chicken and produces a number that is
    // arithmetically correct and means nothing.
    const rows = (await this.db.execute(sql`
      with expected as (
        -- Every core item, not every item that happens to carry a quantity. An
        -- item shipped without one has to null the day and name itself, rather
        -- than quietly shrinking the basket into a smaller total that still
        -- reports as complete.
        select key as item_key, index_quantity
        from items
        where tier = 'core'
      ),
      pins as (
        select b.item_key, b.store_id, b.product_key, s.country,
               pr.size_quantity, pr.size_form, pr.size_approximate,
               ${WANT_BASIS} as want_basis,
               lp.unit_price, lp.unit_price_basis
        from basket_map b
        join stores s on s.store_id = b.store_id
        join items i on i.key = b.item_key
        join products pr on pr.store_id = b.store_id and pr.product_key = b.product_key
        left join latest_price lp
          on lp.store_id = b.store_id and lp.product_key = b.product_key
        where ${PIN_FILTER}
          and (${country ?? null}::text is null or s.country = ${country ?? null})
      ),
      med as (${MEDIAN}),
      good as (
        select p.country, p.item_key, p.store_id, p.product_key, p.want_basis
        from pins p
        left join med m on m.country = p.country and m.item_key = p.item_key
        where not ${SUSPECT}
      ),
      obs as (
        select g.country, g.item_key, g.store_id, g.product_key,
               o.observed_at::date as d, o.unit_price, o.id
        from good g
        join price_observations o
          on o.store_id = g.store_id and o.product_key = g.product_key
        where o.unit_price is not null
          and o.unit_price_basis = g.want_basis
      ),
      country_days as (
        -- Per country, not one global calendar. The Philippines' first usable
        -- price lands a day after the United States', and drawing a PH point on
        -- that first day would be a claim we cannot support.
        select country, generate_series(min(d), current_date, interval '1 day')::date as d
        from obs
        group by country
      ),
      as_of as (
        select distinct on (cd.d, o.country, o.item_key, o.store_id, o.product_key)
               cd.d, o.country, o.item_key, o.store_id, o.unit_price
        from country_days cd
        join obs o on o.country = cd.country and o.d <= cd.d
        order by cd.d, o.country, o.item_key, o.store_id, o.product_key, o.id desc
      ),
      cheapest as (
        select d, country, item_key, min(unit_price) as unit_price
        from as_of
        group by 1, 2, 3
      ),
      grid as (
        select cd.country, cd.d, e.item_key, e.index_quantity,
               case when e.index_quantity is null then null else c.unit_price end as unit_price
        from country_days cd
        cross join expected e
        left join cheapest c
          on c.d = cd.d and c.country = cd.country and c.item_key = e.item_key
      ),
      basket as (
        select
          d::text as d,
          country,
          count(*) filter (where unit_price is not null)::text as priced,
          count(*)::text                                       as expected,
          -- array_agg over an all-priced day returns NULL, not an empty array,
          -- and the cast is what lets Postgres type the empty literal.
          coalesce(
            array_agg(item_key order by item_key) filter (where unit_price is null),
            '{}'::text[]
          ) as missing,
          -- index_quantity is double precision. Without the cast the whole
          -- product resolves to double precision and a float lands in the middle
          -- of a money sum.
          case
            when count(*) filter (where unit_price is null) = 0
            then sum(unit_price * index_quantity::numeric)::text
            else null
          end as total
        from grid
        group by 1, 2
      ),
      store_best as (
        -- A store can hold two pins on one staple. Its price for the staple is
        -- its own cheapest usable pin, the same rule "cheapest" applies
        -- country-wide, so the store lines and the basket line disagree only
        -- where the stores actually do.
        select d, country, store_id, item_key, min(unit_price) as unit_price
        from as_of
        group by 1, 2, 3, 4
      ),
      store_days as (
        -- Unlike the basket, a partial day still totals: the line claims only
        -- what the store charged for what it had, and the priced count is how
        -- the chart knows to dim it. Same ::numeric cast as the basket sum.
        select sb.d, sb.country, sb.store_id, s.name as store_name,
               count(*)::text as priced,
               sum(sb.unit_price * e.index_quantity::numeric)::text as total
        from store_best sb
        join expected e on e.item_key = sb.item_key and e.index_quantity is not null
        join stores s on s.store_id = sb.store_id
        group by 1, 2, 3, 4
      )
      -- Basket rows first per country (nulls first), each branch in ascending
      -- date order -- annotate() reads the basket run as a single left-to-right
      -- pass and must not meet a store row mid-stream. The store branch reuses
      -- the basket's denominator so "9 of 15" means the same thing on any line.
      select d, country, null as store_id, null as store_name,
             priced, expected, missing, total
      from basket
      union all
      select d::text as d, country, store_id, store_name,
             priced, (select count(*) from expected)::text as expected,
             '{}'::text[] as missing, total
      from store_days
      order by country, store_id nulls first, d
    `)) as unknown as IndexRow[];

    const incidents = await this.contributingIncidents(country);
    const byCountry = new Map<Country, BasketPoint[]>();
    const storesByCountry = new Map<Country, StoreDayRow[]>();

    for (const row of rows) {
      const parsed = countrySchema.safeParse(row.country);
      if (!parsed.success) continue;

      // A store id marks the row as one store's own day, kept aside until the
      // country's calendar exists to densify against.
      if (row.store_id !== null && row.store_name !== null) {
        const days = storesByCountry.get(parsed.data) ?? [];
        days.push({
          store_id: row.store_id,
          store_name: row.store_name,
          d: row.d,
          priced: row.priced,
          expected: row.expected,
          total: row.total,
        });
        storesByCountry.set(parsed.data, days);
        continue;
      }

      // The null is the product. A partial basket is not a cheaper basket, so a
      // day missing any core item scores no total at all and the chart draws the
      // gap rather than interpolating across it. The coverage numbers alongside
      // are what let the page say which items were missing instead of leaving
      // the reader to guess at an outage.
      const points = byCountry.get(parsed.data) ?? [];
      points.push({
        date: row.d,
        total: row.total === null ? null : Number(row.total),
        pricedItems: Number(row.priced),
        expectedItems: Number(row.expected),
        missingItemKeys: row.missing ?? [],
      });
      byCountry.set(parsed.data, points);
    }

    return [...byCountry].map(([seriesCountry, points]) => ({
      country: seriesCountry,
      currency: DEFAULT_CURRENCY_BY_COUNTRY[seriesCountry],
      points: annotate(
        points,
        incidents.filter((i) => i.country === seriesCountry),
      ),
      stores: buildStoreSeries(
        points.map((p) => p.date),
        storesByCountry.get(seriesCountry) ?? [],
      ),
    }));
  }

  /**
   * Cheapest pin per canonical item, ranked by unit price.
   *
   * Ranking by sticker price -- which this did until now -- picks the smallest
   * pack rather than the best value, and it was wrong in public: a 50g Nescafe
   * sachet at PHP 51.95 was reported as the cheapest Philippine coffee at
   * PHP 1,039 per kilo, when a 250g bag of beans sits at PHP 757 per kilo.
   */
  async today(country?: Country): Promise<BasketItem[]> {
    const rows = (await this.db.execute(sql`
      with pins as (
        select b.item_key, i.label, s.country,
               coalesce(b.target_size, i.target_size ->> s.country) as unit,
               i.index_quantity, i.index_uom,
               b.store_id, s.name as store_name, b.product_key,
               pr.name as product_name,
               pr.size_quantity, pr.size_form, pr.size_approximate,
               ${WANT_BASIS} as want_basis,
               lp.price, lp.currency, lp.unit_price, lp.unit_price_basis,
               lp.previous_price, lp.delta
        from basket_map b
        join stores s on s.store_id = b.store_id
        join items i on i.key = b.item_key
        join products pr on pr.store_id = b.store_id and pr.product_key = b.product_key
        join latest_price lp
          on lp.store_id = b.store_id and lp.product_key = b.product_key
        where ${PIN_FILTER}
          and (${country ?? null}::text is null or s.country = ${country ?? null})
      ),
      med as (${MEDIAN}),
      flagged as (
        select p.*, ${SUSPECT} as suspect, ${IMPRECISE} as imprecise
        from pins p
        left join med m on m.country = p.country and m.item_key = p.item_key
      ),
      -- The pick happens in its own CTE, before anything is cast to text.
      -- Postgres resolves an ORDER BY name against the select list first, so
      -- casting in the same query that ranks would sort "1039" before "51.95"
      -- and hand back the dearest coffee as the cheapest.
      picked as (
        select distinct on (country, item_key) *
        from flagged
        where not suspect
          and unit_price is not null
          and unit_price_basis = want_basis
        -- store_id is not decoration. Two pins can carry the same unit price,
        -- and without a deterministic tiebreak the winner is whichever row the
        -- planner happened to emit first.
        order by country, item_key, unit_price asc, store_id asc
      )
      select
        item_key, label, country, unit, store_id, store_name, product_name,
        index_quantity::text as index_quantity,
        index_uom,
        price::text          as price,
        currency,
        unit_price::text     as unit_price,
        unit_price_basis,
        (unit_price * index_quantity::numeric)::text as index_contribution,
        imprecise,
        previous_price::text as previous_price,
        delta::text          as delta
      from picked
      order by country, item_key
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
          productName: row.product_name,
          price,
          unitPrice: toMoney(row.unit_price, currency),
          unitPriceBasis: row.unit_price_basis,
          indexQuantity: row.index_quantity === null ? null : Number(row.index_quantity),
          indexUom: row.index_uom,
          indexContribution: toMoney(row.index_contribution, currency),
          imprecise: row.imprecise,
          deltaPct: deltaPct(row.delta, row.previous_price),
        } satisfies BasketItem,
      ];
    });
  }

  /**
   * Every pin for every item, with a verdict on each.
   *
   * The index answers "what does the basket cost"; this answers "where does the
   * same staple cost different money", which is the question nineteen stores can
   * answer today and three days of history cannot.
   *
   * index_contributor is relaxed here on purpose -- a store we do not let move
   * the headline number is still a real shelf with a real price on it. The rest
   * of PIN_FILTER stands.
   */
  async rails(country: Country | undefined, tier: "core" | "core,stretch"): Promise<Rail[]> {
    const tiers =
      tier === "core,stretch" ? sql`i.tier in ('core', 'stretch')` : sql`i.tier = 'core'`;

    const rows = (await this.db.execute(sql`
      with pins as (
        select s.country, b.item_key, i.label, i.index_quantity, i.index_uom,
               b.store_id, s.name as store_name, s.index_contributor,
               b.product_key, pr.name as product_name,
               pr.size_quantity, pr.size_form, pr.size_approximate,
               ${WANT_BASIS} as want_basis,
               lp.price, lp.currency, lp.unit_price, lp.unit_price_basis
        from basket_map b
        join stores s on s.store_id = b.store_id
        join items i on i.key = b.item_key
        join products pr on pr.store_id = b.store_id and pr.product_key = b.product_key
        -- LEFT, not inner. A pin with no observation against it yet is a fact
        -- about the rail; dropping it makes the rail claim three pins where
        -- there are four.
        left join latest_price lp
          on lp.store_id = b.store_id and lp.product_key = b.product_key
        where b.status in ('verified', 'curated')
          and b.product_key is not null
          and ${tiers}
          and (${country ?? null}::text is null or s.country = ${country ?? null})
      ),
      med as (${MEDIAN}),
      judged as (
        select p.*, m.median_unit_price, m.priced,
               ${NO_SIZE}         as no_size,
               ${BASIS_MISMATCH}  as basis_mismatch,
               ${PRICE_OUTLIER}   as price_outlier,
               ${IMPRECISE}       as imprecise
        from pins p
        left join med m on m.country = p.country and m.item_key = p.item_key
      ),
      verdict as (
        select j.*,
               (j.no_size or j.basis_mismatch or j.price_outlier) as suspect,
               (not (j.no_size or j.basis_mismatch or j.price_outlier)
                 and j.unit_price is not null
                 and j.unit_price_basis = j.want_basis) as eligible
        from judged j
      ),
      ranked as (
        -- Ranked in SQL because cheapest and dearest are defined over the
        -- non-suspect pins only, and deriving that a second time in TypeScript
        -- is a second place for the rule to drift.
        select v.*,
               rank() over (partition by v.country, v.item_key
                            order by (case when v.eligible then v.unit_price end)
                                     asc nulls last) as cheap_rank,
               rank() over (partition by v.country, v.item_key
                            order by (case when v.eligible then v.unit_price end)
                                     desc nulls last) as dear_rank
        from verdict v
      ),
      -- Ordered before anything becomes text, for the same reason today() does:
      -- an ORDER BY name binds to the select list, so sorting a ::text alias is
      -- a lexicographic sort wearing a numeric column's name.
      ordered as (
        select *
        from ranked
        order by country, item_key, suspect asc, unit_price asc nulls last, store_id asc
      )
      select
        country, item_key, label,
        index_quantity::text as index_quantity, index_uom,
        store_id, store_name, index_contributor,
        product_key, product_name,
        price::text as price, currency,
        unit_price::text as unit_price, unit_price_basis,
        median_unit_price::text as median_unit_price,
        priced::text as priced,
        case when suspect then 'suspect' when imprecise then 'imprecise' else 'ok' end as flag,
        case
          when no_size        then 'no size on the label, so no unit price'
          when basis_mismatch then 'priced per a different unit than this item is tracked in'
          when price_outlier  then 'more than 10x the typical unit price for this item'
          when size_form = 'range'     then 'the label gives a size range, so the unit price is a midpoint'
          when size_form = 'multipack' then 'a multipack, so the unit price assumes the pack total'
          when size_approximate        then 'the label says approximate, so the unit price is too'
        end as flag_reason,
        (eligible and cheap_rank = 1) as cheapest,
        (eligible and dear_rank = 1 and coalesce(priced, 0) >= 2) as dearest
      from ordered
    `)) as unknown as RailRow[];

    const rails = new Map<string, Rail>();

    for (const row of rows) {
      const parsed = countrySchema.safeParse(row.country);
      if (!parsed.success) continue;

      const currency = row.currency || DEFAULT_CURRENCY_BY_COUNTRY[parsed.data];
      const key = `${parsed.data}:${row.item_key}`;
      let rail = rails.get(key);

      if (!rail) {
        rail = {
          itemKey: row.item_key,
          label: row.label,
          country: parsed.data,
          currency,
          indexQuantity: row.index_quantity === null ? null : Number(row.index_quantity),
          indexUom: row.index_uom,
          medianUnitPrice: toMoney(row.median_unit_price, currency),
          // Below three priced pins the outlier rule never fires, so the rail
          // has to say the pins were not compared rather than imply they passed.
          comparable: Number(row.priced ?? 0) >= 3,
          pins: [],
        };
        rails.set(key, rail);
      }

      rail.pins.push({
        storeId: row.store_id,
        storeName: row.store_name,
        indexContributor: row.index_contributor,
        productKey: row.product_key,
        productName: row.product_name,
        price: toMoney(row.price, currency),
        unitPrice: toMoney(row.unit_price, currency),
        unitPriceBasis: row.unit_price_basis,
        flag: row.flag,
        flagReason: row.flag_reason,
        cheapest: row.cheapest,
        dearest: row.dearest,
      } satisfies RailPin);
    }

    return [...rails.values()];
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

    // Only the incident the gap itself named, and only if it closed in this
    // window. Any resolved incident nearby would put a heal marker on a gap it
    // did not cause -- which reads to a judge as a claim, not a coincidence.
    const closed = incidents.some(
      (i) =>
        i.id === previous.incidentId &&
        i.resolved_at !== null &&
        i.resolved_at > previous.date &&
        i.resolved_at <= point.date,
    );
    return closed ? { ...point, healed: true } : point;
  });
}

/**
 * Densify each store's day rows against the country's calendar.
 *
 * The SQL emits a store-day only where the store had a price, but the chart
 * maps store points onto the basket's own x axis by array position, so every
 * store series must carry every date. A day with no row becomes a null total
 * with nothing priced -- absence, not zero. Exported and free of the class so
 * it can be tested without a database.
 */
export function buildStoreSeries(dates: string[], rows: StoreDayRow[]): StoreSeries[] {
  const byStore = new Map<string, { name: string; days: Map<string, StoreDayRow> }>();
  for (const row of rows) {
    const store = byStore.get(row.store_id) ?? { name: row.store_name, days: new Map() };
    store.days.set(row.d, row);
    byStore.set(row.store_id, store);
  }

  return (
    [...byStore]
      .map(([storeId, store]) => {
        // The denominator rides on the store's own rows; a day the store is
        // absent still shows the same expectation, not a shrunken one.
        const expected = Number([...store.days.values()][0]?.expected ?? 0);
        return {
          storeId,
          storeName: store.name,
          points: dates.map((date) => {
            const day = store.days.get(date);
            return day
              ? {
                  date,
                  total: day.total === null ? null : Number(day.total),
                  pricedItems: Number(day.priced),
                  expectedItems: expected,
                }
              : { date, total: null, pricedItems: 0, expectedItems: expected };
          }),
        };
      })
      // Map insertion order is SQL row order, which is not a contract.
      .sort((a, b) => a.storeName.localeCompare(b.storeName))
  );
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
