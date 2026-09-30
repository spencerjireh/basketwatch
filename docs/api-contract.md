---
title: API Contract
tags: [contract]
created: 2026-08-18
updated: 2026-09-27
status: v2
---

# API contract (v2)

The seam between the API and the dashboard (see
[architecture](architecture.md)). Source of truth is `packages/contract/src/`: zod schemas
with types derived from them, so runtime validation and the compiler read the
same definition. Both apps are typed by those schemas — change a schema and
every consumer of it together, or neither.

v2 replaces the frozen v1 from the pre-rebuild codebase. The shapes are
mostly recognisable; the differences are listed at the bottom.

## Conventions

- JSON only. Timestamps are ISO 8601 **UTC** strings.
- Money is `{ amount: number, currency: string }` — never a preformatted
  string, and never two sibling fields, so an amount cannot be separated from
  its currency by a refactor. The UI owns formatting because the UI knows the
  locale.
- `country` appears on every store-, product- and basket-shaped payload.
- Errors always take one envelope:
  `{ error: { code, message, requestId, details? } }`. `requestId` is the id
  every log line for that request carries, so a screenshot is enough to find the
  cause.
- Lists that can grow are cursor-paginated: `{ items, nextCursor }`, queried
  with `?limit=&cursor=`.

## The prefix

The API sets a global `api` prefix with **no exclusions**, and the dashboard
rewrites `/api/:path*` through **without stripping**. The path is identical at
every layer:

| Where | URL |
|---|---|
| dev, direct | `localhost:3001/api/health` |
| dev, via the dashboard | `localhost:3000/api/health` |
| prod, inside compose | `api:3001/api/health` |
| prod, public | `basketwatch.spencerjireh.com/api/health` |

## Dashboard reads

Every read below is **public and unauthenticated**, deliberately: the dashboard
has no login, so anything it renders has to be reachable without a secret.

| Endpoint | Response | Implemented |
|---|---|---|
| `GET /api/health` | `HealthResponse` | yes |
| `GET /api/health/ready` | `ReadyResponse`, 503 when degraded | yes |
| `GET /api/fleet` | `FleetScraper[]` | yes |
| `GET /api/basket/index?country=PH` | `BasketSeries[]` | yes |
| `GET /api/basket/today?country=PH` | `BasketItem[]` | yes |
| `GET /api/basket/rails?country=PH&tier=core` | `Rail[]` | yes |
| `GET /api/products/search?q=rice&country=PH` | `Page<ProductHit>` | yes |
| `GET /api/feed?limit=&cursor=` | `Page<FeedEvent>` | yes |
| `GET /api/incidents?state=open&limit=&cursor=` | `Page<Incident>` | yes |
| `GET /api/incidents/:id` | `Incident` | yes |

`country` is optional on the basket endpoints. The contract lists PH alone,
and every read that joins `stores` filters on `stores.active`, so rows from
the US era never reach the wire.

`BasketSeries` also carries an optional `stores` array — per-store daily sums
(index contributors only, at index quantities), each store's points parallel to
the series' own. A store's partial day still totals and is flagged by
`pricedItems < expectedItems`, where the country total nulls instead: the
basket's number claims the whole basket, a store's line claims only what that
store charged for what it had.

`Incident` carries its evidence, so one request draws the whole record.

## Government prices

Read-only series collected from public government bulletins: DOE weekly pump
prices (by city and brand, min-max) and monthly LPG, the DOE Oil Monitor's
weekly adjustments, DA Bantay Presyo daily wet-market prices, and DTI suggested
retail prices. Each route answers empty until its source has been ingested.

| Endpoint | Query | Response |
|---|---|---|
| `GET /api/gov/fuel` | `region` (default NCR), `product` (default RON 95) | `FuelResponse`: latest week, per-city brand ranges, the week's adjustment, 12-week median |
| `GET /api/gov/lpg` | none | `LpgResponse`: 11-kg cylinder min-max per month |
| `GET /api/gov/markets` | `commodity` (optional) | `MarketsResponse`: latest day, price per market per specification |
| `GET /api/gov/srp` | `q` (optional) | `SrpResponse`: current bulletin items |

## Streaming

The API is read-only: there are no write endpoints. Runs, prices and
incidents are written into Postgres by a separate private service.

| Endpoint | Body | Auth | Implemented |
|---|---|---|---|
| `GET /api/stream` (SSE) | `FeedEvent` per message | none | stream opens, silent |

Rate limit: 300/minute globally. Health and the SSE stream are exempt.

SSE sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, and
emits a heartbeat comment every 20s. Each frame carries `id:`, so a browser
reconnect sends `Last-Event-ID` and the server can resume. SSE remains the
cuttable path: the fallback is polling these same endpoints, and nothing about
the contract changes if it goes.

`packages/contract/src/pullers.ts` still exports the price-row and manual-run
shapes (`priceRecordSchema`, `pullerRunQuerySchema`, `pullerRunResponseSchema`,
`indexContributorBodySchema`): the collector imports the contract, and those
are its shapes. Nothing in this API serves them.

## Vocabulary

Const array plus derived type, never a TS enum, so one list drives both runtime
validation and the UI's exhaustiveness checks:

`countries`, `scraperStates`, `runStatuses`, `incidentKinds`, `incidentStates`,
`feedEventKinds`, `checkNames`.

`incidentKinds` keeps the `studio_*` kinds from the Bright Data era as
legacy values: nothing writes them, and the rows that carry them still
render as themselves.

## What changed from v1

- **Money is grouped.** `price: number` + `currency: string` became
  `price: Money`.
- **Pagination exists.** `/api/feed` and `/api/incidents` return `Page<T>`.
  Cursor pagination cannot be added to a shipped contract without breaking every
  caller, and the target is 50+ stores.
- **Store identity, not scraper identity.** `FleetScraper.id` became
  `storeId`; the store row is the stable identity.
- **`runStatuses` won the vocabulary conflict.** The database column holds
  `ok|anomalous|error` on live rows; the contract uses `ok|suspect|broken`,
  matching the validator and the state machine. `database/mappers/run-status`
  translates on read until migration 0001 normalises the rows.
- **Everything is under `/api`,** including health.
- `BasketPoint` gained `incidentId`, so a gap in the index can name the incident
  that caused it.
- `BasketItem` gained `unitPrice` and `unitPriceBasis`, which is what makes a
  5 lb bag and a 5 kg sack comparable.

## What changed in the post-pivot cut (2026-09)

- **One country.** `countries` is `["PH"]`. `country` stays on every
  payload; US-era rows are filtered out server-side by `stores.active`.
- **No heal, no budget, no ingest.** `HealAttempt`, `CanaryResult`,
  `CreditBudget`, the `/api/heal/*`, `/api/budget`, `/api/ingest/*` and
  `/api/fleet/*provision*` routes are gone. `Incident` lost `collectorId` and
  `attempts`; `FleetScraper` lost `collectorId`, `healsToday`, `hasTemplate`;
  `scraperStates` lost `healing` and `verifying`; `feedEventKinds` replaced
  `healing`/`healed` with `recovery`; `BasketPoint` lost `healed` and kept
  `incidentId`.
- **`pull_failed`** joined `incidentKinds`, and `error` joined `checkNames`,
  for the pull that threw or returned nothing.
- `priceRecordSchema` moved from `ingest.ts` to `pullers.ts`.

## What changed in the read-only split (2026-09-27)

- **No writes.** `POST /api/pullers/run`, `POST /api/pullers/:storeId/run`,
  `POST /api/fleet/seed-baselines` and `POST /api/fleet/:storeId/index-contributor`
  are gone, with `routes.runPuller`, `routes.runPullerFleet` and
  `routes.fleetIndexContributor`. Collection runs in a separate private service.
- **`ReadyResponse.checks.queue` is optional.** The API runs no job queue; the
  field stays in the schema so older responses still parse.

## Known gaps

- Nothing computes `FleetScraper.nullRatePct` from the run itself; it is
  derived at query time from `runs` and `baselines`.
- **`priceRecordSchema` has not caught up with the data plane.** Postgres
  carries size and unit price; the row contract still does not. Outstanding:
  - `unit: z.string().min(1)` must become nullable. Rows with no parseable
    size are still perfectly good prices; as written the contract rejects
    them at the door.
  - Add `size_value`, `size_uom`, `size_quantity`, `size_base_uom`,
    `size_approximate` and `unit_price`, all nullable. Unit price is the
    comparison primitive and almost no store publishes it, so we compute it.
    Emit nothing rather than a guess.
  - Add `size_change` to `incidentKinds`. A pinned product whose size shrinks
    while its price holds is shrinkflation, and today it is invisible.

  These touch `packages/contract`, so the dashboard's fixtures move in the same
  commit — see the coupling rule in `AGENTS.md`.
