# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this repo is

A grocery basket index for the Philippines: shelf prices read straight from
supermarket catalogues, a fifteen-staple basket priced in every store, and a
validator that opens an incident when a store's pull stops making sense. This
repo is the product codebase with design docs alongside it.

Read the doc that matches the work, not all of them:

- Adding or wiring an API module: `docs/architecture.md` (HLD; diagrams
  inline as mermaid).
- Touching `packages/contract` or endpoint shapes: `docs/api-contract.md`.

## Layout

The repo root **is** the product monorepo (pnpm workspaces + Turborepo). There
is no app subdirectory; `apps/` and `packages/` sit beside the compose files.

- `apps/api` — orchestrator: NestJS + Drizzle + pg-boss (Postgres-backed job
  queue, no Redis). One directory per domain under `src/modules/`. Only
  `*.repository.ts` may touch the Drizzle schema; a lint rule enforces it. The
  spider-sense validator in `modules/validator/checks.ts` stays pure and IO-free.
- `apps/web` — dashboard (Next.js App Router + Tailwind, no component
  library). A pure client of the API: it never touches Postgres, and a lint rule
  enforces that too.
- `packages/contract` — zod schemas and types. The only thing the two apps
  share, and the reason the boundary above holds.
- `packages/tsconfig`, `packages/eslint-config` — shared configs.
- `docs/` — design docs (`architecture.md`, `api-contract.md`) and brand
  assets.

Parker's Pantry (`apps/pantry`) is live at `pantry.spencerjireh.com/ph` as
the test store the pulls are allowed to break. Not yet wired: the notifier
module (channels scaffolded, nothing enqueues alerts).

## Commands

The compose files, the workspace and the docs all live at the **repo root**.
There is no nesting any more: `pnpm` and `just` both run from here.

`just` is the entry point. `just` on its own lists every recipe.

```sh
pnpm install
just up             # local postgres
just dev            # contract watch + api :3001 + dashboard :3000
just check          # typecheck, lint, test, build
just db-migrate     # local database; see the warning below
just db-backup      # dump the DEPLOYED database before anything risky
```

Run `just dev`, not an app's own dev script: the API depends on the contract
package's watch build, and starting an app alone means contract edits stop
propagating.

**`DATABASE_URL` in the root `.env` points at the LOCAL database.** The deployed
one lives in `.env.prod` and nothing loads it by default: `just db-backup` reads
that file, and anything else pointed at production has to name it. The `just
db-*` recipes still pass the local URL inline so they never depend on what
`.env` happens to hold, and `drizzle.config.ts` still refuses a non-local host
unless you pass `ALLOW_REMOTE_DB=1`. Migration `0000` must keep its exact bytes
— see the README.

To restore a production dump into the local database for testing:
`just db-backup`, then `just db-restore-local <file>`.

Deployment: root `docker-compose.prod.yml` is THE deployment unit
(single Docker Compose resource watching `main`; secrets via deploy-time env
vars). All four services deploy: `postgres`, published on port `55432` for
the team to write scraped data into, plus `api`, `web`, and `pantry`. `web` binds
**3000**, not 80, and `API_INTERNAL_URL` is a Docker build arg rather than a
runtime variable. The API applies pending migrations itself on boot, ahead of
the queue and the first request — a deploy has no step where a human
runs drizzle-kit. Never deploy without the user's go-ahead.

## Hard rules

- **Never commit secrets.** Two files, both at the repo **root**, beside
  `.env.example` and the compose files: `.env` for what you are working against
  (local by default) and `.env.prod` for the deployed database, loaded only when
  named. Both are gitignored. There is still no per-app copy — that rule is
  about apps, not about these two. Never print API keys in output or code.
- **`OPS_TOKEN` belongs to the API alone.** The dashboard has no login, so a
  token in the web container makes every visitor an operator on our credentials.
  Prod compose passes it to `api` and not to `web`, turbo does not forward it to
  the web dev server, and nothing under `apps/web` may read it.
- **Pulls hit real stores.** Do not run the fleet or a store in bulk without
  the user's go-ahead; `?dryRun=true` fetches and parses but writes nothing.
  `max_pages` on the store row is the crawl ceiling and every adapter checks it
  before each fetch.
- **Public data only.** No login-walled, paywalled, or private sources
  (house rule).
- **Kill only listeners.** Use `lsof -ti:PORT -sTCP:LISTEN | xargs kill` —
  a bare `lsof -ti:PORT` also matches browsers connected to the port.
- **Don't deploy** anything without the user's explicit go-ahead.
- **Never push to `main`.** Branch, open a PR, merge the PR — see
  [CONTRIBUTING.md](./CONTRIBUTING.md). A pre-push hook enforces this once
  `git config core.hooksPath .githooks` has been run in the clone.

## Conventions

- TypeScript everywhere; strict mode; match existing style (2-space,
  no semicolon changes, keep files small and typed).
- Validator checks stay pure and unit-tested; incidents must be replayable
  from their stored evidence.
- The API contract lives in `packages/contract/src/`, as zod
  schemas with types derived from them, and is documented in
  `docs/api-contract.md`. Both apps are typed by those schemas —
  change a schema and every consumer of it together, or neither.
- Money is `{ amount, currency }`, never a preformatted string and never two
  sibling fields. Timestamps are ISO 8601 UTC strings. `country` appears on
  every store-, product- and basket-shaped payload; the contract lists PH
  alone, and rows from the US era keep theirs with `stores.active = false`.
- Do not run the API under `tsx`, and do not enable
  `@typescript-eslint/consistent-type-imports` for it: esbuild has no
  `emitDecoratorMetadata`, and the lint autofix strips the value imports Nest
  needs, so both break dependency injection silently.
- No emojis in code, docs, or output.

## Current state

- Every dashboard route answers from Postgres; there are no fixtures.
  Migrations run 0000-0015.
- The puller engine covers the pullable stores (three adapters, crawl
  config from the `stores` table): `POST /api/pullers/:storeId/run`, and
  `?dryRun=true` writes nothing. The pull schedule ships disarmed
  (`PULL_SCHEDULE_ENABLED` defaults false); arming it is a team decision,
  never a deploy default.
- **Collection.** `stores.method` names the adapter: `shopify` (Ever, Shop
  Gaisano, Shop Suki), `magento-graphql` (SM Markets), `sitemap` (Parker's
  Pantry). Landers and MerryMart are `none` until a browser adapter and a
  feed exist for them. The adapters share one plain HTTP fetcher; there is
  no proxy, no vendor, and no browser in the path.
- **Incidents.** The validator seeds baselines on boot, validates every
  applied run (schema, null rates, row count, price drift), opens an
  incident with evidence on a `broken` verdict, and resolves a store's open
  incidents on the next `ok` verdict. A pull that throws or returns nothing
  for an established store opens a `pull_failed` incident directly. Nothing
  repairs an adapter on its own; that is a person's job, and the incident
  says what to look at.
- **Philippines only.** The contract lists one country. US store rows from
  the project's first weeks stay in the database with `active = false` and
  keep their history; every read that joins `stores` filters on `active`.
- **Parker's Pantry.** `apps/pantry` at `pantry.spencerjireh.com/ph` serves
  a sitemap and JSON-LD product pages in layout A and neither in layout B, so
  `just pantry-layout ph b` breaks the pull on purpose and `ph a` lets the
  next run resolve the incident.
- Not yet wired: the notifier module (channels scaffolded, nothing enqueues
  alerts).
