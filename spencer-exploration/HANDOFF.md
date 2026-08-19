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
