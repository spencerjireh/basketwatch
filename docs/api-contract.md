---
title: API Contract
tags: [hackathon, contract]
created: 2026-08-18
status: frozen-v1
---

# API contract (frozen v1)

The seam between the two work slices in
[architecture](architecture.md) section 5. Response types live in
`scrape-verse/packages/shared/src/api.ts` and are the single source of truth;
`scrape-verse/apps/web/src/data/mock.ts` holds fixtures in exactly those
shapes. Change the type and the fixture together, or neither.

Conventions: JSON only, timestamps are ISO 8601 UTC strings, money is a
number plus an ISO currency code (never a preformatted string), and `country`
is present on every store-, product- and basket-shaped payload.

## Dashboard reads

| Endpoint | Response | Implemented |
|---|---|---|
| `GET /health` | `{ ok: true }` | yes |
| `GET /api/fleet` | `FleetScraper[]` | no |
| `GET /api/basket/index?country=US` | `BasketSeries[]` | no |
| `GET /api/basket/today?country=US` | `BasketItem[]` | no |
| `GET /api/feed?limit=50` | `FeedEvent[]` | no |
| `GET /api/incidents?state=open` | `Incident[]` | no |
| `GET /api/incidents/:id` | `Incident` | no |
| `GET /api/budget` | `CreditBudget` | no |

`country` is optional on the basket endpoints: omit it to get every country
(which is what the comparison view asks for), pass it to get one.

`Incident` carries its `evidence` bundle and its full `attempts` array, so the
heal audit view renders from a single response: diagnosis, prompt, Studio
diff, canary result, verdict, credits.

## Writes and inbound

| Endpoint | Body | Auth | Implemented |
|---|---|---|---|
| `POST /ingest/:scraperId` | `PriceRecord[]` | `X-Webhook-Secret` | accepts, does not persist |
| `POST /api/scrapers/:id/run` | `{}` | ops token | no |
| `GET /api/stream` (SSE) | `FeedEvent` per message | none | no |

SSE is the P0-but-cuttable live path; the fallback is polling these same
endpoints, so nothing about the contract changes if it gets cut.

## Shared vocabulary

Enums are exported as const arrays plus derived types, so both runtime
validation and the UI use the same list:

- `countries` / `Country`
- `scraperStates` / `ScraperState` — the state machine in
  [architecture](architecture.md) section 3.2
- `incidentKinds` / `IncidentKind`, `incidentStates` / `IncidentState`
- `healVerdicts` / `HealVerdict`
- `feedEventKinds` / `FeedEventKind`
- `checkNames` / `CheckName`, `runStatuses` / `RunStatus`

The validator's `Baseline`, `CheckResult` and `Verdict` also live in shared
(re-exported from `apps/api/src/validator/checks.ts` for convenience) because
incident evidence and the dashboard audit view speak the same vocabulary.

## Known gaps to close before the data plane lands

Closed Aug 20 when `catalogue.db` was migrated into Postgres. The data plane now
carries the catalogue shape: `country` and `currency` on `stores`, identity as
`(store_id, product_key)` on `products`, and per-row `unit`, `unit_price` and
`unit_price_basis` on `price_observations`. `BasketItem.productKey` is
`items.key`; `cheapestStore` is a join through `basket_map` to `latest_price`.

Still open:

- Nothing computes `FleetScraper.nullRatePct`, `healsToday` or
  `CreditBudget.spentTodayUsd` yet; those are derived at query time from
  `runs`, `heal_attempts` and `baselines`.
- No endpoint reads the database yet. Every row in the tables above is `no`
  until the query layer lands.
- **`priceRecordSchema` has not caught up with the data plane.** Postgres
  carries size and unit price; the fleet output contract still does not.
  Three changes are outstanding, all specified in
  [spencer-exploration/HANDOFF.md](../spencer-exploration/HANDOFF.md) with a
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
    be rendered as what it is instead of being silently blended in.
  - Add `size_change` to `incidentKinds`. A pinned product whose size shrinks
    while its price holds is shrinkflation, and today it is invisible.

  These touch `packages/shared`, so `apps/web/src/data/mock.ts` moves in the
  same commit — see the coupling rule in `AGENTS.md`. Studio creation prompts
  must also ask for the size explicitly, or every size field arrives empty.
