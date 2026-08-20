import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import {
  DEFAULT_CURRENCY_BY_COUNTRY,
  countrySchema,
  unitPriceBasisSchema,
  type ProductHit,
  type ProductSearchQuery,
  type ProductSearchResponse,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";
import { toMoney } from "../../database/mappers/money.mapper.js";
import { decodeSearchCursor, takeSearchPage } from "../../common/search-cursor.js";

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
  /** the leading sort value, already stringified for the cursor */
  sort_value: string | null;
};

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class ProductsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async search(query: ProductSearchQuery): Promise<ProductSearchResponse> {
    const cursor = decodeSearchCursor(query.cursor, query.sort);
    const byPrice = query.sort === "unit_price";

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
      : sql`(-similarity(pr.name, ${query.q}))::numeric`;

    const seek: SQL = cursor
      ? sql`and (${leadRank}, ${leadValue}, pr.store_id, pr.product_key)
             > (
               ${cursor.v === null ? 1 : 0},
               ${cursor.v ?? 0}::numeric,
               ${cursor.s}::text,
               ${cursor.k}::text
             )`
      : sql``;

    const rows = (await this.db.execute(sql`
      select
        pr.store_id, s.name as store_name, s.country,
        pr.product_key, pr.name, pr.url,
        pr.size_quantity, pr.size_base_uom,
        coalesce(pr.size_approximate or pr.size_form in ('multipack', 'range'), false)
          as imprecise,
        lp.price::text as price, lp.currency,
        lp.unit_price::text as unit_price, lp.unit_price_basis,
        lp.observed_at,
        ${leadValue}::text as sort_value
      from products pr
      join stores s on s.store_id = pr.store_id
      /*
       * The latest_price view is a DISTINCT ON over every observation and the
       * planner cannot push a join into it, so it costs the whole table however
       * selective the search is. Measured on production for q=rice, country=US:
       * 84ms through the view, 14.5ms through this lateral. The difference is
       * structural, not a tuning detail.
       */
      left join lateral (
        select o.price, o.currency, o.unit_price, o.unit_price_basis, o.observed_at
        from price_observations o
        where o.store_id = pr.store_id and o.product_key = pr.product_key
        order by o.id desc
        limit 1
      ) lp on true
      where pr.name ilike ${"%" + query.q + "%"}
        and (${query.country ?? null}::text is null or s.country = ${query.country ?? null})
        and (${query.storeId ?? null}::text is null or pr.store_id = ${query.storeId ?? null})
        and (${query.basis ?? null}::text is null or lp.unit_price_basis = ${query.basis ?? null})
        ${seek}
      order by ${leadRank} asc, ${leadValue} asc, pr.store_id asc, pr.product_key asc
      limit ${query.limit + 1}
    `)) as unknown as HitRow[];

    const page = takeSearchPage(rows, query.limit, (row) => ({
      o: query.sort,
      // Only a null unit price makes a null key, and only under a price sort;
      // relevance always has a value.
      v: byPrice && row.unit_price === null ? null : row.sort_value,
      s: row.store_id,
      k: row.product_key,
    }));

    return { items: page.items.flatMap((row) => toHit(row)), nextCursor: page.nextCursor };
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
    },
  ];
}
