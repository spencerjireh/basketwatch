---
title: API Contract
tags: [hackathon, contract]
created: 2026-08-18
updated: 2026-08-20
status: v2
---

# API contract (v2)

The seam between the two work slices in [architecture](architecture.md)
section 5. Source of truth is `packages/contract/src/`: zod schemas
with types derived from them, so runtime validation and the compiler read the
same definition. `apps/web/src/fixtures/dashboard.ts` holds fixtures
in exactly those shapes. Change the schema and the fixture together, or neither.

v2 replaces the frozen v1 that lived in `scrape-verse/packages/shared/src/api.ts`.
The shapes are mostly recognisable; the differences are listed at the bottom.

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

This is why the Bright Data webhook target did not change across the rewrite.

## Dashboard reads

| Endpoint | Response | Implemented |
|---|---|---|
| `GET /api/health` | `HealthResponse` | yes |
| `GET /api/health/ready` | `ReadyResponse`, 503 when degraded | yes |
| `GET /api/fleet` | `FleetScraper[]` | no |
| `GET /api/basket/index?country=US` | `BasketSeries[]` | no |
| `GET /api/basket/today?country=US` | `BasketItem[]` | no |
| `GET /api/feed?limit=&cursor=` | `Page<FeedEvent>` | no |
| `GET /api/incidents?state=open&limit=&cursor=` | `Page<Incident>` | no |
| `GET /api/incidents/:id` | `Incident` | no |
| `GET /api/budget` | `CreditBudget` | no |

`country` is optional on the basket endpoints: omit it for every country, which
is what the comparison view asks for.

`Incident` is deliberately a fat response — evidence and every heal attempt
travel with it, so the audit view renders from one request instead of three.

## Writes and inbound

| Endpoint | Body | Auth | Implemented |
|---|---|---|---|
| `POST /api/ingest/:scraperId` | `PriceRecord[]` | `X-Webhook-Secret` | validates, does not persist |
| `POST /api/pullers/:storeId/run?dryRun=` | none | `Authorization: Bearer <OPS_TOKEN>` | no |
| `GET /api/stream` (SSE) | `FeedEvent` per message | none | stream opens, silent |

Both secrets are compared with `timingSafeEqual`, not `===`: these endpoints are
public, and a plain compare leaks the prefix over enough requests.

`dryRun` fetches and parses exactly as a real run does and writes nothing, which
is what makes a store's crawl config safe to change against production data.

SSE sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, and
emits a heartbeat comment every 20s. Each frame carries `id:`, so a browser
reconnect sends `Last-Event-ID` and the server can resume. SSE remains the
cuttable path: the fallback is polling these same endpoints, and nothing about
the contract changes if it goes.

## Vocabulary

Const array plus derived type, never a TS enum, so one list drives both runtime
validation and the UI's exhaustiveness checks:

`countries`, `scraperStates`, `runStatuses`, `incidentKinds`, `incidentStates`,
`healVerdicts`, `feedEventKinds`, `checkNames`, `dataSources`.

## What changed from v1

- **Money is grouped.** `price: number` + `currency: string` became
  `price: Money`.
- **Pagination exists.** `/api/feed` and `/api/incidents` return `Page<T>`.
  Cursor pagination cannot be added to a shipped contract without breaking every
  caller, and the target is 50+ stores.
- **Store identity, not scraper identity.** `FleetScraper.id` became
  `storeId`, with a nullable `collectorId`. Most stores are pulled over HTTP and
  have no Studio collector at all.
- **`runStatuses` won the vocabulary conflict.** The database column holds
  `ok|anomalous|error` on live rows; the contract uses `ok|suspect|broken`,
  matching the validator and the state machine. `database/mappers/run-status`
  translates on read until migration 0001 normalises the rows.
- **Everything is under `/api`,** including health.
- `BasketPoint` gained `incidentId`, so a gap in the index can name the incident
  that caused it.
- `BasketItem` gained `unitPrice` and `unitPriceBasis`, which is what makes a
  5 lb bag and a 5 kg sack comparable.

## Known gaps

- `HealAttempt` carries `attempt`, `startedAt`, `finishedAt` and `canary`, and
  the `heal_attempts` table has none of those columns — it holds only
  `created_at`. This is deliberate: the audit view is the demo centrepiece, so
  the gap surfaces as a type error when the repository is written rather than as
  a blank panel. Closing it is item 1 of migration 0001.
- Nothing computes `FleetScraper.nullRatePct`, `healsToday`, or
  `CreditBudget.spentToday` yet; all are derived at query time from `runs`,
  `heal_attempts` and `baselines`.
- No endpoint reads the database. Every row above marked `no` returns 501.
- **`priceRecordSchema` has not caught up with the data plane.** Postgres
  carries size and unit price; the fleet output contract still does not. The v2
  rewrite did not close this — `packages/contract/src/ingest.ts` still has the
  v1 shape. Four changes are outstanding, all specified in
  [lab/spencer-exploration/HANDOFF.md](../lab/spencer-exploration/HANDOFF.md) with a
  tested reference implementation in its `basket.py`:
  - `unit: z.string().min(1)` must become nullable. 4,276 of 28,376 catalogue
    rows have no parseable size and are still perfectly good prices; as
    written the contract rejects 15% of the catalogue at the door.
  - Add `size_value`, `size_uom`, `size_quantity`, `size_base_uom`,
    `size_approximate` and `unit_price`, all nullable. Unit price is the
    comparison primitive — raw prices across different pack sizes are not
    comparable — and almost no store publishes it, so we compute it. Emit
    nothing rather than a guess: a collector that returned `"1G"` for a
    product titled `"1Gal."` priced cooking oil at PHP 799,950 per kilo.
  - Add `source` (`studio` or `puller`), so a fallback-collected segment can
    be rendered as what it is instead of being silently blended in. The
    vocabulary already exists in the contract as `dataSources`; the ingest
    schema just does not use it yet.
  - Add `size_change` to `incidentKinds`. A pinned product whose size shrinks
    while its price holds is shrinkflation, and today it is invisible.

  These touch `packages/contract`, so the dashboard's fixtures move in the same
  commit — see the coupling rule in `AGENTS.md`. Studio creation prompts must
  also ask for the size explicitly, or every size field arrives empty.

  Note the asymmetry this leaves today: `BasketItem` (a dashboard read) already
  carries `unitPrice` and `unitPriceBasis`, because the database has them.
  `PriceRecord` (a fleet write) does not, so a collector cannot supply what the
  dashboard is ready to display.
