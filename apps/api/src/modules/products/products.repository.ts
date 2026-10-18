import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import {
  DEFAULT_CURRENCY_BY_COUNTRY,
  DROP_THRESHOLD,
  LISTED_WITHIN_DAYS,
  countrySchema,
  unitPriceBasisSchema,
  type DropsQuery,
  type DropsResponse,
  type ProductDetail,
  type ProductHit,
  type ProductSearchQuery,
  type ProductSearchResponse,
  type SrpReference,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { toMoney } from "../../database/mappers/money.mapper.js";
import {
  decodeSearchCursor,
  takeSearchPage,
  type SearchOrder,
} from "../../common/search-cursor.js";

type HitRow = {
  store_id: string;
  store_name: string;
  country: string;
  product_key: string;
  name: string;
  url: string | null;
  price: string | null;
  currency: string | null;
  unit_price: string | null;
  unit_price_basis: string | null;
  size_quantity: number | null;
  size_base_uom: string | null;
  imprecise: boolean;
  observed_at: string | null;
  category: string | null;
  last_seen: string;
  spark: { d: string; p: string | number }[] | null;
  /** the leading sort value, already stringified for the cursor */
  sort_value: string | null;
};

/**
 * Search words, each matched on its own: "alaska evap 370ml" finds
 * "Alaska Evaporada 370ml" whatever the word order. One-letter words are
 * dropped; they match nearly every row and no trigram index can serve them.
 */
export function searchTokens(q: string): string[] {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[%_\\]/g, ""))
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 8);
}

/** Every token must appear in the column; true when there are no tokens. */
function allTokens(column: SQL, tokens: string[]): SQL {
  if (tokens.length === 0) return sql`true`;
  return sql.join(
    tokens.map((t) => sql`${column} ilike ${"%" + t + "%"}`),
    sql` and `,
  );
}

/** How far under the median a price sits: 0.18 is 18% under. */
export function pctBelow(price: number, median: number): number {
  if (!(median > 0)) return 0;
  return Math.round(((median - price) / median) * 1000) / 1000;
}

/*
 * The columns every hit carries, over `pr` (products), `s` (stores) and the
 * `lp` (latest observation) and `sp` (sparkline) laterals below.
 */
const HIT_COLUMNS = sql`
  pr.store_id, s.name as store_name, s.country, s.category,
  pr.product_key, pr.name, pr.url, pr.last_seen,
  pr.size_quantity, pr.size_base_uom,
  coalesce(pr.size_approximate or pr.size_form in ('multipack', 'range'), false)
    as imprecise,
  lp.price::text as price, lp.currency,
  lp.unit_price::text as unit_price, lp.unit_price_basis,
  lp.observed_at, sp.spark`;

const LATEST = sql`
  left join lateral (
    select o.price, o.currency, o.unit_price, o.unit_price_basis, o.observed_at
    from price_observations o
    where o.store_id = pr.store_id and o.product_key = pr.product_key
    order by o.id desc
    limit 1
  ) lp on true`;

// The 30 most recent steps through idx_obs_product, reversed to oldest first.
const SPARK = sql`
  left join lateral (
    select json_agg(json_build_object('d', to_char(x.observed_at at time zone 'UTC', 'YYYY-MM-DD'), 'p', x.price)
                    order by x.id) as spark
    from (
      select o.id, o.observed_at, o.price
      from price_observations o
      where o.store_id = pr.store_id and o.product_key = pr.product_key
      order by o.id desc
      limit 30
    ) x
  ) sp on true`;

const LISTED = sql`pr.last_seen > now() - make_interval(days => ${LISTED_WITHIN_DAYS})`;

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class ProductsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async search(query: ProductSearchQuery): Promise<ProductSearchResponse> {
    const term = query.q;
    const byPrice = query.sort === "unit_price";

    /*
     * No term, no relevance: similarity() against nothing is 0 for every row,
     * and a constant is not an ordering. Neutralising it rather than removing
     * it would be the expensive mistake here -- the planner drops a constant
     * sort key only when EC_MUST_BE_REDUNDANT holds, which requires
     * ec_sortref == 0, and a top-level ORDER BY clause always has one. Both
     * leading components would survive, the lateral would run over all 28k
     * rows and they would all be sorted to return 40. Every page.
     *
     * So the browse path drops them and orders by the name index instead.
     * Asking for a price sort is still honoured with no term; only relevance
     * has nothing to rank.
     */
    const browsing = !byPrice && term === undefined;
    const order: SearchOrder = browsing ? "browse" : query.sort;
    const cursor = decodeSearchCursor(query.cursor, order);

    /*
     * The sort key, decorated so it contains no NULLs.
     *
     * A keyset over a nullable leading column cannot use a bare row comparison:
     * `unit_price > $v` is NULL rather than false when the column is null, and
     * the nulls-last tail of the page silently disappears. Ranking nulls into
     * an explicit 1 puts the whole ordering inside a total, NULL-free tuple, so
     * one lexicographic `>` is exactly `unit_price asc nulls last`.
     *
     * coalesce(unit_price, 0) does not assume prices are non-negative. When the
     * price is null the rank already differs, so the comparison short-circuits
     * on the first component and the sentinel is never reached.
     */
    // The cast is not cosmetic: a bare integer literal in an ORDER BY is an
    // ordinal position, so `order by 0` is an error rather than a constant.
    const leadRank = byPrice
      ? sql`(case when lp.unit_price is null then 1 else 0 end)`
      : sql`0::int`;
    // Relevance descends, and a row comparison only ascends. Negating the lead
    // turns "most similar first" into an ascending key without a second
    // predicate shape. similarity() is never null, so no rank decoration.
    const leadValue = byPrice
      ? sql`coalesce(lp.unit_price, 0)`
      : sql`(-word_similarity(${term ?? ""}, pr.name))::numeric`;

    const seek: SQL = !cursor
      ? sql``
      : browsing
        ? // name is NOT NULL, so the browse key needs no rank decoration: the
          // three columns are already a total order and already the index.
          sql`and (pr.name, pr.store_id, pr.product_key)
               > (${cursor.v ?? ""}::text, ${cursor.s}::text, ${cursor.k}::text)`
        : sql`and (${leadRank}, ${leadValue}, pr.store_id, pr.product_key)
               > (
                 ${cursor.v === null ? 1 : 0},
                 ${cursor.v ?? 0}::numeric,
                 ${cursor.s}::text,
                 ${cursor.k}::text
               )`;

    const orderBy = browsing
      ? sql`order by pr.name asc, pr.store_id asc, pr.product_key asc`
      : sql`order by ${leadRank} asc, ${leadValue} asc, pr.store_id asc, pr.product_key asc`;

    // pr.name rather than a constant: it is the browse cursor's leading value,
    // and selecting it here keeps similarity() -- and so pg_trgm, which
    // the baseline migration lets fail to install -- off the default view of the page.
    const sortValue = browsing ? sql`pr.name` : sql`${leadValue}::text`;

    /*
     * Omitted rather than `ilike '%%'`. An empty pattern extracts no trigrams,
     * so a GIN search on idx_products_name_trgm degrades to scanning the whole
     * index with a recheck per row, and `null ilike '%%'` would be null rather
     * than true. No predicate has neither problem.
     */
    const tokens = term === undefined ? [] : searchTokens(term);
    const nameMatch = allTokens(sql`pr.name`, tokens);

    const rows = (await this.db.execute(sql`
      select ${HIT_COLUMNS}, ${sortValue} as sort_value
      from products pr
      join stores s on s.store_id = pr.store_id
      /*
       * The latest_price view is a DISTINCT ON over every observation and the
       * planner cannot push a join into it, so it costs the whole table however
       * selective the search is. Measured on production for q=rice, country=US (US-era data):
       * 84ms through the view, 14.5ms through this lateral. The difference is
       * structural, not a tuning detail.
       */
      ${LATEST}
      ${SPARK}
      where ${nameMatch}
        and s.active
        and ${LISTED}
        and (${query.category ?? null}::text is null or s.category = ${query.category ?? null})
        and (${query.country ?? null}::text is null or s.country = ${query.country ?? null})
        and (${query.storeId ?? null}::text is null or pr.store_id = ${query.storeId ?? null})
        and (${query.basis ?? null}::text is null or lp.unit_price_basis = ${query.basis ?? null})
        ${seek}
      ${orderBy}
      limit ${query.limit + 1}
    `)) as unknown as HitRow[];

    const page = takeSearchPage(rows, query.limit, (row) => ({
      o: order,
      // Only a null unit price makes a null key, and only under a price sort;
      // relevance and browse always have a value. The fallback is not defensive
      // noise: a null v on a non-nullable key would seek from the wrong end and
      // end the page chain in silence.
      v: byPrice && row.unit_price === null ? null : (row.sort_value ?? ""),
      s: row.store_id,
      k: row.product_key,
    }));

    // The reference row belongs to the first page of a typed search only.
    const srp = tokens.length > 0 && !cursor ? await this.srp(tokens) : [];
    return { items: page.items.flatMap((row) => toHit(row)), nextCursor: page.nextCursor, srp };
  }

  /** DTI SRP items in the latest bulletin whose product or category holds every token. */
  private async srp(tokens: string[]): Promise<SrpReference[]> {
    const rows = (await this.db.execute(sql`
      select s.commodity as category, s.variant as product, s.unit as size,
             p.price_min::text as price, p.period_start::text as effective
      from gov_series s
      join gov_prices p on p.series_id = s.id
      where s.source = 'dti_srp'
        and p.period_start = (
          select max(p2.period_start) from gov_prices p2
          join gov_series s2 on s2.id = p2.series_id where s2.source = 'dti_srp')
        and ${allTokens(sql`(s.variant || ' ' || s.commodity)`, tokens)}
      order by p.price_min
      limit 3
    `)) as unknown as { category: string; product: string; size: string; price: string; effective: string }[];
    return rows.map((r) => ({ ...r, price: Number(r.price) }));
  }

  /*
   * Candidates first: only a product priced down in the last week can be a
   * drop, and price_observations records exactly those as change = 'price'
   * with a negative delta. The 30-day median then runs over that short list,
   * not the catalogue: the price steps inside the window plus the one in
   * effect when it opened.
   */
  async drops(query: DropsQuery): Promise<DropsResponse> {
    const rows = (await this.db.execute(sql`
      with candidates as (
        select distinct o.store_id, o.product_key
        from price_observations o
        where o.observed_at > now() - interval '7 days'
          and o.change = 'price' and o.delta < 0
      ),
      medians as (
        select c.store_id, c.product_key,
               percentile_cont(0.5) within group (order by w.price) as median30,
               count(*) as steps
        from candidates c
        cross join lateral (
          select o.price from price_observations o
          where o.store_id = c.store_id and o.product_key = c.product_key
            and o.observed_at > now() - interval '30 days'
          union all
          (select o.price from price_observations o
           where o.store_id = c.store_id and o.product_key = c.product_key
             and o.observed_at <= now() - interval '30 days'
           order by o.id desc limit 1)
        ) w
        group by c.store_id, c.product_key
      )
      select ${HIT_COLUMNS}, m.median30::text as median30, null::text as sort_value
      from medians m
      join products pr on pr.store_id = m.store_id and pr.product_key = m.product_key
      join stores s on s.store_id = pr.store_id
      ${LATEST}
      ${SPARK}
      where m.steps >= 2
        and s.active
        and pr.last_seen > now() - interval '2 days'
        and lp.price <= ${1 - DROP_THRESHOLD} * m.median30
        and (${query.category ?? null}::text is null or s.category = ${query.category ?? null})
      order by (m.median30 - lp.price) / nullif(m.median30, 0) desc, pr.store_id, pr.product_key
      limit ${query.limit}
    `)) as unknown as (HitRow & { median30: string })[];

    return {
      items: rows.flatMap((row) =>
        toHit(row).map((hit) => {
          const median30 = Number(row.median30);
          return { ...hit, median30, pctBelow: pctBelow(hit.price?.amount ?? 0, median30) };
        }),
      ),
    };
  }

  /** One product with all of its history; null when the store or key is unknown. */
  async detail(storeId: string, productKey: string): Promise<ProductDetail | null> {
    const [row] = (await this.db.execute(sql`
      select ${HIT_COLUMNS}, pr.unit, pr.first_seen, null::text as sort_value,
             (${LISTED}) as listed
      from products pr
      join stores s on s.store_id = pr.store_id
      ${LATEST}
      ${SPARK}
      where pr.store_id = ${storeId} and pr.product_key = ${productKey}
    `)) as unknown as (HitRow & { unit: string | null; first_seen: string; listed: boolean })[];
    if (!row) return null;
    const [hit] = toHit(row);
    if (!hit) return null;

    const history = (await this.db.execute(sql`
      select o.observed_at, o.price::text as price, o.unit_price::text as unit_price
      from price_observations o
      where o.store_id = ${storeId} and o.product_key = ${productKey}
      order by o.id
    `)) as unknown as { observed_at: string; price: string; unit_price: string | null }[];

    const [stats] = (await this.db.execute(sql`
      select
        (select min(o.price) from price_observations o
         where o.store_id = ${storeId} and o.product_key = ${productKey}
           and o.observed_at > now() - interval '90 days')::text as low90,
        (select percentile_cont(0.5) within group (order by w.price) from (
           select o.price from price_observations o
           where o.store_id = ${storeId} and o.product_key = ${productKey}
             and o.observed_at > now() - interval '30 days'
           union all
           (select o.price from price_observations o
            where o.store_id = ${storeId} and o.product_key = ${productKey}
              and o.observed_at <= now() - interval '30 days'
            order by o.id desc limit 1)
         ) w)::text as median30
    `)) as unknown as { low90: string | null; median30: string | null }[];

    // Same parsed size in another store, and a name the trigram index calls similar.
    const sameSize =
      row.size_quantity === null || row.size_base_uom === null
        ? []
        : ((await this.db.execute(sql`
            select ${HIT_COLUMNS}, null::text as sort_value
            from products pr
            join stores s on s.store_id = pr.store_id
            ${LATEST}
            ${SPARK}
            where pr.store_id <> ${storeId}
              and s.active
              and ${LISTED}
              and pr.size_base_uom = ${row.size_base_uom}
              and pr.size_quantity = ${row.size_quantity}
              and pr.name % ${row.name}
            order by similarity(pr.name, ${row.name}) desc, lp.price nulls last
            limit 10
          `)) as unknown as HitRow[]);

    const { spark: _spark, ...product } = hit;
    return {
      product: { ...product, unit: row.unit, firstSeen: new Date(row.first_seen).toISOString() },
      listed: row.listed,
      history: history.map((h) => ({
        at: new Date(h.observed_at).toISOString(),
        price: Number(h.price),
        unitPrice: h.unit_price === null ? null : Number(h.unit_price),
      })),
      low90: stats?.low90 == null ? null : Number(stats.low90),
      median30: stats?.median30 == null ? null : Number(stats.median30),
      sameSize: sameSize.flatMap((r) => toHit(r)),
    };
  }
}

function toHit(row: HitRow): ProductHit[] {
  const country = countrySchema.safeParse(row.country);
  if (!country.success) return [];

  const currency = row.currency || DEFAULT_CURRENCY_BY_COUNTRY[country.data];
  const basis = unitPriceBasisSchema.safeParse(row.unit_price_basis);

  return [
    {
      storeId: row.store_id,
      storeName: row.store_name,
      country: country.data,
      productKey: row.product_key,
      name: row.name,
      url: row.url,
      price: toMoney(row.price, currency),
      unitPrice: toMoney(row.unit_price, currency),
      unitPriceBasis: basis.success ? basis.data : null,
      sizeQuantity: row.size_quantity,
      sizeBaseUom: row.size_base_uom,
      imprecise: row.imprecise,
      observedAt: row.observed_at ? new Date(row.observed_at).toISOString() : null,
      category: row.category,
      lastSeen: new Date(row.last_seen).toISOString(),
      spark: (row.spark ?? []).map((pt) => ({ d: pt.d, p: Number(pt.p) })),
    },
  ];
}
