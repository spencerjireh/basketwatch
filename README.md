<img src="docs/brand/banner.png" alt="The Basketwatch mark, a price line that breaks where data is missing, next to the wordmark basketwatch." width="800">

# basketwatch

A grocery basket index for the Philippines. It reads shelf prices straight
from supermarket catalogues, prices the same fifteen staples in every store at
the same quantities, and shows what the basket costs today and how it moved.
When a store's site changes and the pull stops making sense, the index shows a
gap for that day rather than a guess: a missing price is never interpolated.

Built with NestJS, Next.js, and Postgres.

- **Live:** [basketwatch.spencerjireh.com](https://basketwatch.spencerjireh.com) — no login, no signup
- **Parker's Pantry** (our own test store): [pantry.spencerjireh.com/ph](https://pantry.spencerjireh.com/ph)
- **Docs:** [architecture](docs/architecture.md) · [API contract](docs/api-contract.md)

## What you are looking at

<img src="docs/screenshots/prod-ph-front.png" alt="The front page: a price terrain drawn from live shelf data, with staple rows, store columns, and height showing each store's price as a multiple of the cheapest." width="800">

The front page draws a price terrain from live shelf data: rows are fifteen
staples, columns are stores with the cheapest basket on the left, and height
is each store's price as a multiple of the cheapest shelf for that staple.
Hovering a point shows the product, the price, and when it was scraped. Below
the terrain, each staple gets every store's price side by side. **Behind the
data** shows where each number came from and which prices we do not fully
trust, and **Prices** is a raw search over the stores' catalogues, about
27,000 products.

<img src="docs/screenshots/prod-panorama.png" alt="The basket over time: each store's basket cost as a line, with hatched spans on days that could not be fully priced." width="800">

## The stores

| Store               | Pulled through                   | In the index       |
| ------------------- | -------------------------------- | ------------------ |
| Ever Supermarket    | Shopify `products.json`          | yes                |
| Shop Gaisano        | Shopify `products.json`          | yes                |
| Shop Suki           | Shopify `products.json`          | yes                |
| SM Markets          | Magento GraphQL                  | yes                |
| Landers Superstore  | parked: the site needs a browser | yes, from history  |
| MerryMart Wholesale | parked: no machine-readable feed | yes, from history  |
| Parker's Pantry     | sitemap + JSON-LD product pages  | never (test clone) |

A parked store keeps its price history and its place in the index; it stops
getting new observations until an adapter exists for it. US stores from the
project's first weeks are still in the database with `active = false`: their
history is kept, nothing reads it.

## How collection works

Each store row names a `method`, and the method names an adapter: `shopify`
pages through `/products.json`, `magento-graphql` walks the category tree,
`sitemap` reads the sitemap and each product page's JSON-LD. The adapters
share one plain HTTP fetcher with browser headers, a 30-second timeout and a
32 MB body cap. Adding a store is a row edit.

A pull dedupes the rows, diffs them against the store's last known prices,
and writes only the changes, so the history is change-only and every run
row says how many rows the pull returned. If more than 90% of an
established catalogue changes at once, the run is recorded but the
observations are not applied: a wholesale change is far more likely to be a
product-key scheme change than a repricing of everything.

After every applied run the validator compares the store's products against a
rolling baseline: schema parse rate, row count, per-field null rates, price
drift. A `broken` verdict opens an incident with the findings as evidence,
one per store at a time. A pull that throws, or that returns nothing for a
store with history, opens a `pull_failed` incident without going through the
validator. An `ok` verdict on a later run resolves whatever was open: the
store came back, and the record says so.

Days with an open incident on an index store render as hatched gaps on the
chart, labelled with the incident.

## Parker's Pantry, the test store

Real stores break on their own schedule, so we host one we may break on
purpose. `apps/pantry` serves a ten-product storefront at
`pantry.spencerjireh.com/ph` with a sitemap and JSON-LD product pages.
`just pantry-layout ph b` flips it to a layout with no structured data;
the next pull returns zero rows and opens an incident. `just pantry-layout
ph a` restores it, and the next pull resolves the incident. Both flips are
guarded by `PANTRY_ADMIN_TOKEN`.

Its prices are generated (a deterministic seeded walk of at most 1.5% per
day per product), the storefront is labelled as fake, and it ships with
`index_contributor = false`, so it renders on the dashboard but never moves
the index. Letting it in is a deliberate ops action behind the ops token.

---

# Development

## Layout

```
apps/api        NestJS + Drizzle + pg-boss. Owns every read and write, incl. SSE.
apps/web        Next.js dashboard. A pure client of the API; never touches Postgres.
apps/pantry     Parker's Pantry, the test store.
packages/       contract (the zod schemas both apps share), tsconfig, eslint-config.
docs/           architecture, API contract, brand assets.
```

`apps/api/src/modules/` holds one directory per domain: `pullers` (the
adapters and the run pipeline), `validator` (baseline checks and incidents),
`basket` (the index, the rails, the cheapest cart), `fleet` (store state and
the index flag), `products` (catalogue search).

## Commands

`just` is the entry point; run `just` on its own to list every recipe. Use
`just dev` rather than an app's own dev script: the API depends on the
contract package's watch build.

```sh
pnpm install
just up             # local postgres
just dev            # contract watch + api :3001 + dashboard :3000
just check          # typecheck, lint, test, build
```

## Database

**`DATABASE_URL` in the repo-root `.env` points at the LOCAL database.** The
deployed one lives in `.env.prod`, which nothing loads by default, and
`drizzle.config.ts` refuses a non-local host unless you pass
`ALLOW_REMOTE_DB=1`. The schema describes a live database holding real data,
and migration `0000` must keep its exact bytes: drizzle decides what to apply
from the journal's `when` timestamp, and re-running `0000` against production
fails on its one unguarded statement.

## The API seam

Nest sets a global `api` prefix and the dashboard rewrites `/api/:path*`
straight through without stripping, so the path is identical from browser to
container: `/api/health` answers the same at `localhost:3000`,
`localhost:3001`, and `basketwatch.spencerjireh.com`.
