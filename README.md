<img src="docs/brand/banner.png" alt="The Basketwatch mark, a price line that breaks where data is missing, next to the wordmark basketwatch." width="800">

# basketwatch

A grocery basket index that tracks real shelf prices across sixteen stores in
the United States and the Philippines, and repairs its own scrapers when a
store changes its website. When a collector breaks, the system reads the
failure from its own output, asks Bright Data Scraper Studio to rewrite the
extraction code, and verifies the fix with a live re-scrape — no human in the
loop. Days where a price could not be collected render as gaps in the index,
never interpolated.

Built with NestJS, Next.js, and Postgres for the Bright Data x WeMakeDevs
[Into the Scrape-Verse](https://www.wemakedevs.org/hackathons/scrape-verse)
hackathon.

- **Live demo:** [basketwatch.spencerjireh.com](https://basketwatch.spencerjireh.com) — no login, no signup
- **Demo video:** [youtu.be/9L9E7pTpCWk](https://youtu.be/9L9E7pTpCWk)
- **Parker's Pantry** (our disclosed test store): [US](https://pantry.spencerjireh.com/us) · [PH](https://pantry.spencerjireh.com/ph)
- **Docs:** [Scraper Studio usage](docs/scraper-studio-usage.md) · [architecture](docs/architecture.md) · [API contract](docs/api-contract.md) · [collector manifest](docs/collector-manifest.json)

## What you are looking at

<img src="docs/screenshots/prod-ph-front.png" alt="The front page: a price terrain drawn from live shelf data, with staple rows, store columns, and height showing each store's price as a multiple of the cheapest." width="800">

The front page draws a price terrain from live shelf data: rows are fifteen
staples, columns are stores with the cheapest basket on the left, and height
is each store's price as a multiple of the cheapest shelf for that staple.
Hovering a point shows the product, the price, and when it was scraped; one
click switches the page between the United States and the Philippines. Below
the terrain, each staple gets every store's price side by side. **Behind the
data** shows where each number came from and which prices we do not fully
trust, and **Prices** is a raw search over more than 28,000 products.

<img src="docs/screenshots/prod-panorama.png" alt="The basket over time: each store's basket cost as a line, with hatched spans on days that could not be fully priced." width="800">

## The fleet

Nineteen real stores are registered, sixteen of them actively pulled, plus
the two disclosed Parker's Pantry clones. In the 24 hours before this
snapshot, 13 of the 16 returned fresh rows; the three that returned nothing
have open incidents, visible on the
[Self-healing](https://basketwatch.spencerjireh.com/healing) page rather than
hidden.

Snapshot of `GET /api/fleet` on 2026-08-23 (UTC). The `c_*` values are the
live Bright Data Scraper Studio collector IDs.

| Store                  | Country | Scraper Studio collector | In the index            | Last pull (rows)           |
| ---------------------- | ------- | ------------------------ | ----------------------- | -------------------------- |
| Ever Supermarket       | PH      | HTTP pull                | yes                     | Aug 23 (6,962)             |
| Shop Gaisano           | PH      | HTTP pull                | yes                     | Aug 23 (65)                |
| Shop Suki              | PH      | `c_mt5q0jzi18h73rtbha`   | yes                     | Aug 23 (291)               |
| SM Markets             | PH      | `c_mt5adrno248hml4trg`   | yes                     | Aug 23 (0 — incident open) |
| Landers Superstore     | PH      | `c_mt5bbos7onya4mufc`    | yes                     | Aug 23 (0 — incident open) |
| MerryMart Wholesale    | PH      | `c_mt5afb93oof2430yg`    | yes                     | Aug 23 (0 — incident open) |
| Amigo Foods            | US      | `c_mt5sf35quefc5u6s8`    | yes                     | Aug 23 (168)               |
| Cypress Indian Grocery | US      | `c_mt5sf1hn2gm0alggzg`   | yes                     | Aug 23 (167)               |
| Dierbergs              | US      | `c_mt5bcgh01q3exw9das`   | no                      | Aug 23 (389)               |
| H Mart                 | US      | `c_mt5ahmtdb7c4qmkkf`    | no                      | Aug 23 (1)                 |
| Kesar Grocery          | US      | `c_mt5ag34x28n7do143j`   | yes                     | Aug 23 (296)               |
| Latimex Market         | US      | `c_mt5sf4te2nl1om58n6`   | yes                     | Aug 23 (92)                |
| Lili Mart              | US      | `c_mt5si8vp2cd0f03mfp`   | yes                     | Aug 23 (122)               |
| MexGrocer              | US      | `c_mt5siakh3td7a3dk1`    | yes                     | Aug 23 (95)                |
| MexMax                 | US      | HTTP pull                | yes                     | Aug 23 (142)               |
| Sukli                  | US      | HTTP pull                | yes                     | Aug 23 (1,946)             |
| Parker's Pantry (US)   | US      | HTTP pull                | never (disclosed clone) | on demand                  |
| Parker's Pantry (PH)   | PH      | HTTP pull                | never (disclosed clone) | on demand                  |

## How Bright Data Scraper Studio runs this

The application decides when to collect, whether the output is healthy, and
what to ask for when it is not; Scraper Studio does the collecting and the
repairing. Twelve of the sixteen stores run as Studio collectors (the `c_*`
IDs above); the other four expose a structured `/products.json` catalogue and
are pulled over HTTP.

**Collection.** Each collector's extraction logic was generated by Scraper
Studio's AI from a seed URL and a plain-language description ("product name,
price, currency, stock status from this product page; do not follow links").
A pull hands the collector a bounded URL list, filtered to the tracked
staples — which cuts each pull 10-20x — and Studio renders each page in a
cloud browser and returns structured rows.

**Self-healing.** When a pull fails the validator's baseline checks (schema,
null rates, row count, price drift), an incident opens and the repair runs
autonomously:

1. **Diagnose** — compare the failed output field by field against the last
   healthy baseline.
2. **Compose** — build a targeted heal prompt naming the broken fields;
   small, field-specific prompts beat broad rewrites.
3. **Propose** — send it to Studio's `refactor_template` API, which returns
   a rewritten collector and a preview of its output.
4. **Judge** — validate the preview against the same baseline; a pass
   approves, a fail re-proposes with the failure as feedback.
5. **Verify** — one canary pull against the store's live pages; only a
   passing canary resolves the incident.

Every step — evidence, prompt, diff, canary, verdict — is persisted and
rendered on the [Self-healing](https://basketwatch.spencerjireh.com/healing)
page.

**Reproducibility and spend.**
[`collector-manifest.json`](docs/collector-manifest.json) records each
store's seed URL and creation description, so the provisioning endpoint can
recreate the whole fleet on any Bright Data account. Heal attempts are capped
per incident and per scraper per day, and every collector description bounds
its crawl scope — the lesson of an unbounded crawl that cost $26 in early
development.

The full walkthrough is in
[Scraper Studio usage](docs/scraper-studio-usage.md).

## The self-healing loop, demonstrated

<img src="docs/screenshots/prod-healing.png" alt="The Self-healing page: every store, its status, its last pull, and its open incidents." width="800">

Parker's Pantry is a fictional grocery store we host ourselves, so the heal
loop has a target we are allowed to break. We flipped its storefront to an
alternate layout: the next pull returned zero rows and opened an incident;
the heal loop sent the broken page to Scraper Studio, whose rewrite stitched
the redesign's split price back together; a canary pull returned ten rows
with zero nulls and the incident closed. No human intervened. Total cost: a
few cents.

Full disclosure, because a price tracker must not launder fake data: Parker's
Pantry prices are generated (a deterministic seeded walk of at most 1.5% per
day per product), both storefronts are labeled as fake, and they ship with
`index_contributor = false`, so they render on the dashboard but never move
the country index.

---

# Development

## Layout

```
apps/api        NestJS + Drizzle + pg-boss. Owns every read and write, incl. SSE.
apps/web        Next.js dashboard. A pure client of the API; never touches Postgres.
apps/pantry     Parker's Pantry, the disclosed clone store.
packages/       contract (the zod schemas both apps share), tsconfig, eslint-config.
docs/           architecture, API contract, collector manifest, brand assets.
```

`apps/api/src/modules/` holds one directory per domain: `pullers` (the data
pipeline), `heal` (the self-healing orchestrator), `validator` (baseline
checks and incidents), `fleet` (provisioning and scraper state).

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

## Parker's Pantry, the test rig

`apps/pantry` serves the two storefronts at `pantry.spencerjireh.com` (`/us`,
`/ph`). `just pantry-layout us b` flips the US storefront to the breaking
layout and `a` restores it, guarded by `PANTRY_ADMIN_TOKEN`. Letting a clone
into the index is a deliberate ops action behind the ops token.

## The API seam

Nest sets a global `api` prefix and the dashboard rewrites `/api/:path*`
straight through without stripping, so the path is identical from browser to
container: `/api/health` answers the same at `localhost:3000`,
`localhost:3001`, and `basketwatch.spencerjireh.com`.
