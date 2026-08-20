# Handoff: what exploration decided that the app has to absorb

Exploration deliberately stops at the repo boundary. Nothing under `scrape-verse/`
was touched. This file states the changes the app needs and why, so whoever picks it
up is not reverse-engineering intent from JSON.

## 1. The output contract needs size and unit price

`priceRecordSchema` in `scrape-verse/packages/shared/src/index.ts` currently carries
`unit` as free text - "500g", "16 oz. Loaf.", "5kg". That is enough to display and
useless to compare.

**Unit price is the comparison primitive**, not a nicety. It is legally mandated on
grocery shelves in the EU, Australia (online retailers explicitly included) and around
17 US states, precisely because raw prices across different pack sizes are not
comparable. Every cross-store, cross-country and over-time comparison in this product
depends on it.

We must compute it, because almost nobody publishes it. A scan of every cached product
page in `raw/` found structured unit pricing at exactly two sites: Dierbergs
(`unit_price` fields) and WebstaurantStore (JSON-LD `unitCode` / `referenceQuantity`).
Everywhere else it is free text or absent.

Proposed addition, alongside the existing fields rather than replacing them:

```ts
size_value: z.number().positive().nullable(),      // 5, 0.25, 24
size_uom: z.string().nullable(),                   // "kg", "oz", "ml", "count"
size_quantity: z.number().positive().nullable(),   // normalised: 5000, 250, 24
size_base_uom: z.enum(["g", "ml", "count"]).nullable(),
size_approximate: z.boolean().default(false),      // ranges, "approx 1.4kg"
unit_price: z.number().positive().nullable(),      // price / size_quantity
```

Nullable throughout on purpose. `spencer-exploration/basket.py` refuses to guess when
a size is a bundle of unknown contents - "6 Pack" says how many bundles, not how much
is in them - and the app should carry that same refusal rather than invent a number.
A wrong unit price is worse than a missing one for a product whose headline is that
the index never lies.

Reference implementation to port, already tested: `parse_size`, `to_base` and
`unit_price` in `spencer-exploration/basket.py`, covered by `test_basket.py` for
fractions ("1/4 Kg" is 250 g, not 4 kg), multipacks ("12 x 2g" is 24 g), ranges,
fluid ounces, and bare counts ("12's", "30pcs").

**Studio scraper prompts must ask for the size explicitly**, or the field arrives
empty and none of the above works.

## 2. Size change is a distinct incident kind

If a pinned product's size shrinks while its price holds, that is not a price move -
it is shrinkflation, and today it would be invisible.

It is not an edge case. BLS applies an explicit *quantity adjustment* for it,
Statistics Canada found **29.6% of eligible CPI grocery items shrank between 2021 and
2023**, and scanner-data research shows that ignoring package size flips measured
cumulative food inflation from -0.3% to -4%. Ignoring it does not add noise; it
changes the answer.

Add `size_change` to `incidentKinds` in `packages/shared/src/index.ts`. The validator
raises it when `size_quantity` moves on a pinned product between runs. It belongs to
the same theme as the rest of the project - data that is silently wrong rather than
visibly broken - and it is a free differentiator, since the scraper already has to
capture size for unit pricing.

## 3. An unavailable pinned product gaps the series and opens an incident

Decided in the interview, and it is a validator rule rather than a scraper one.

When a pinned product is out of stock or its page dies: **record null, chart a visible
gap, open an incident.** Never silently substitute, and never carry the last price
forward. Official CPI practice does substitute with quality adjustment, but it has
trained collectors making that judgement; we do not. Silent substitution would make a
product swap and a scraper fault indistinguishable, which destroys exactly the signal
`validateRun` exists to detect.

Picking the replacement is a human or heal-loop decision, recorded in
`spencer-exploration/manual-basket.json` alongside the existing curated picks.

## 4. Items and pins are data, not code

`spencer-exploration/items.json` is the item registry: 20 tracked items with units,
per-country target sizes, localised match terms and category hints. The **core tier is
exactly the `docs/prd.md` section 5 basket**, so the headline index is unchanged and
nothing already built is invalidated; the stretch tier broadens it into a price
checker.

`basket-map.json` is the per-store pin table - which concrete product each store is
tracked on for each item. Onboarding a store is adding rows there, and adding a
country needs no code, since country already drives units, currency and match terms.

When these move into Postgres, they map onto the existing `products` and
`priceRecords` tables in `apps/api/src/db/schema.ts`.

## 5. The coupling that will bite

`AGENTS.md` states that `packages/shared` and `apps/web/src/data/mock.ts` are the API
contract and must change together or not at all. Items 1 and 2 change
`packages/shared`, so `mock.ts` moves in the same commit. That is the whole reason
this handoff is a document instead of a patch.

## 6. The catalogue layer

`catalogue.py` produces the tracker data the app will actually serve: 17,746 products
across 13 stores, 15,260 with a computed unit price. Rows carry the `priceRecordSchema`
fields plus `store_id`, `country`, `category`, `size` and `unit_price`.

Rows were validated against the real contract, and doing so caught two bugs worth
knowing about when porting:

- **Timestamps must end in `Z`.** Zod's `.datetime()` rejects a `+00:00` offset unless
  `offset: true` is set, and the fleet contract does not set it. Every row failed until
  the format changed.
- **Shopify publishes no currency.** `/products.json` has no currency field at all, so
  it is derived from the store's country. A source-provided value always wins.

Two files carry the durable record and should map onto Postgres directly:

- `catalogue/runs.jsonl` - one row per store per run (rows, pages, ceiling reached,
  coverage). This is the input `checkRowCount` needs; without it a truncated pull is
  indistinguishable from a mass price change.
- `catalogue/changes.jsonl` - one row per price move, carrying the previous price and
  delta. This is the price history.

Per-store catalogue JSON is regenerable and gitignored.


## 7. The catalogue is a SQLite database now, and Studio collects it

Two things changed on 2026-08-20 that the app inherits directly.

**`catalogue.db` replaces the per-store JSON as the store.** It is committed, it is
~11MB, and it opens with any SQLite client. Its schema is the closest thing to a written
contract this project has, and it was designed to be ported rather than migrated around:

    stores              fleet members: country, currency, method, endpoint, ceilings,
                        coverage, studio_collector_id, needs_browser
    products            identity is (store_id, product_key); size decomposed into
                        size_value / size_uom / size_quantity / size_base_uom /
                        size_form / size_approximate, exactly as section 1 proposes
    price_observations  change-only history: price, unit_price, in_stock, observed_at,
                        source, run_id, change, previous_price, delta
    runs                one row per store per run, always, even at zero changes
    incidents           reserved for the validator; written today when a Studio
                        collector fails and the puller covers

`latest_price` is a view joining on `MAX(id)` rather than `MAX(observed_at)`, because
observations written in the same second would otherwise tie and return both rows.

The invariant to preserve when this moves to Postgres: **`run_id` is mandatory on every
observation, and a run row is written unconditionally.** That is the entire mechanism by
which `checkRowCount` can distinguish a truncated pull from a genuine mass price move. A
change-only history without per-run summaries is not safe.

**Studio is the collector; the puller is the fallback.** Rows carry `source`, which is
`studio` or `puller`. The app should render a fallback-sourced segment visibly
differently rather than hiding it - the decision recorded is that a fallback fills the
data *and* opens an incident, so continuity and honesty both hold. `priceRecordSchema`
needs `source` alongside the size fields from section 1.

One more contract note, learned the expensive way: **`unit` cannot be required.** 2,509
of 17,792 rows have no parseable size, and they are still perfectly trackable prices.
`z.string().min(1)` rejects 14% of the catalogue at the door.
