# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this repo is

Team entry for the WeMakeDevs "Into the Scrape-Verse" hackathon
(Aug 17-23, 2026): a self-healing grocery price tracker built on Bright
Data Scraper Studio. This repo is the product codebase with design docs alongside it.

Read the doc that matches the work, not all of them:

- Adding or wiring an API module: `docs/architecture.md` (HLD; diagrams
  inline as mermaid).
- Touching `packages/contract` or endpoint shapes: `docs/api-contract.md`.
- Provisioning Studio collectors: `docs/collector-manifest.json` (canonical
  definitions for all 16 stores).

## Layout

The repo root **is** the product monorepo (pnpm workspaces + Turborepo). There
is no app subdirectory; `apps/` and `packages/` sit beside the compose files.

- `apps/api` — orchestrator: NestJS + Drizzle + pg-boss (Postgres-backed job
  queue, no Redis). One directory per domain under `src/modules/`. Only
  `*.repository.ts` may touch the Drizzle schema; a lint rule enforces it. The
  spider-sense validator in `modules/validator/checks.ts` stays pure and IO-free.
- `apps/web` — dashboard (Next.js App Router + Tailwind + Recharts, no component
  library). A pure client of the API: it never touches Postgres, and a lint rule
  enforces that too.
- `packages/contract` — zod schemas and types. The only thing the two apps
  share, and the reason the boundary above holds.
- `packages/tsconfig`, `packages/eslint-config` — shared configs.
- `docs/` — design docs (`architecture.md`, `api-contract.md`) and
  the collector manifest used by `ProvisionService`.

Parker's Pantry (`apps/pantry`) is live at `pantry.spencerjireh.com` as the
disclosed clone store for staged break-and-heal demos. Not yet wired: the
notifier module (scaffolded, no delivery channel).

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

Deployment: root `docker-compose.prod.yml` is THE Coolify deployment unit
(single Docker Compose resource watching `main`; secrets via Coolify env
vars). All four services deploy: `postgres`, published on port `55432` for
the team to write scraped data into, plus `api`, `web`, and `pantry`. `web` binds
**3000**, not 80, and `API_INTERNAL_URL` is a Docker build arg rather than a
runtime variable. The API applies pending migrations itself on boot, ahead of
the queue and the first request — a Coolify deploy has no step where a human
runs drizzle-kit. Never deploy without the user's go-ahead.

Bright Data CLI (`brightdata`, v0.3.4+) drives Scraper Studio:
`scraper create <url> "<desc>"`, `scraper run <id> [url]`,
`scraper heal <id> "<prompt>" --auto-approve --auto-save`,
`scraper approve <id>`, `budget`.

## Hard rules

- **Never commit secrets.** Two files, both at the repo **root**, beside
  `.env.example` and the compose files: `.env` for what you are working against
  (local by default) and `.env.prod` for the deployed database, loaded only when
  named. Both are gitignored. There is still no per-app copy — that rule is
  about apps, not about these two. Never print API keys in output, code, or the
  demo video.
- **`OPS_TOKEN` belongs to the API alone.** The dashboard has no login, so a
  token in the web container makes every visitor an operator on our credentials.
  Prod compose passes it to `api` and not to `web`, turbo does not forward it to
  the web dev server, and nothing under `apps/web` may read it.
- **Credits are finite (~$50 per account).** Production spend is controlled
  by heal caps (`HEAL_MAX_ATTEMPTS_PER_INCIDENT`,
  `HEAL_MAX_PER_SCRAPER_PER_DAY`). Raise a cap deliberately, never silently.
  Do not create/run/heal scrapers in bulk without the user's go-ahead.
- **Bound every scraper.** Creation prompts must state the crawl scope
  explicitly ("this product page only", "front page only") — an unbounded
  description once crawled ~150 pages.
- **Public data only.** No login-walled, paywalled, or private sources
  (hackathon rule and house rule).
- **Kill only listeners.** Use `lsof -ti:PORT -sTCP:LISTEN | xargs kill` —
  a bare `lsof -ti:PORT` also matches browsers connected to the port.
- **Don't deploy** anything without the user's explicit go-ahead.
- **Never push to `main`.** Branch, open a PR, merge the PR — see
  [CONTRIBUTING.md](./CONTRIBUTING.md). A pre-push hook enforces this once
  `git config core.hooksPath .githooks` has been run in the clone.
- The pre-build HN heal test is excluded from demo material (team decision).

## Conventions

- TypeScript everywhere; strict mode; match existing style (2-space,
  no semicolon changes, keep files small and typed).
- Validator checks stay pure and unit-tested; incidents must be replayable
  from stored `raw_output`.
- The API contract lives in `packages/contract/src/`, as zod
  schemas with types derived from them, and is documented in
  `docs/api-contract.md`. Both apps are typed by those schemas —
  change a schema and every consumer of it together, or neither.
- Money is `{ amount, currency }`, never a preformatted string and never two
  sibling fields. Timestamps are ISO 8601 UTC strings. `country` appears on
  every store-, product- and basket-shaped payload.
- Do not run the API under `tsx`, and do not enable
  `@typescript-eslint/consistent-type-imports` for it: esbuild has no
  `emitDecoratorMetadata`, and the lint autofix strips the value imports Nest
  needs, so both break dependency injection silently.
- No emojis in code, docs, or output.

## Current state

Snapshot, accurate as of Aug 22.

- Every dashboard route answers from Postgres; there are no fixtures.
  Migrations run 0000-0008.
- The puller engine covers the sixteen pullable stores (four adapters, crawl
  config from the `stores` table): `POST /api/pullers/:storeId/run`, and
  `?dryRun=true` writes nothing. The pull schedule ships disarmed
  (`PULL_SCHEDULE_ENABLED` defaults false); a scheduled run bypasses the
  guarded wrapper, so arming it is a team decision, never a deploy default.
- **Studio-only production pipeline (decided Aug 22).** In production, every
  store is collected through a Bright Data Studio scraper -- there is no HTTP
  fallback. If a store has no collector, the pull fails with a clear error
  requiring provisioning. If Studio fails on a provisioned store, the failure
  is real: it gets recorded, validated, diagnosed, and triggers a heal through
  Studio's self-healing API. This is the core narrative of the hackathon --
  Bright Data's self-healing scrapers as the single data path, not one of
  many. HTTP adapters (shopify, magento-graphql, sitemap) remain in the
  codebase as probing and diagnostic tools that inform collector descriptions;
  the Studio adapter itself uses sitemap discovery internally for product-page
  collectors. Collector definitions (seed URLs, descriptions, probe findings)
  live in `docs/collector-manifest.json`.
- **Self-healing diagnostic loop (landed Aug 22).** The validator seeds
  baselines on boot, validates every run (schema, null rates, row count, price
  drift), opens incidents with evidence, and enqueues a heal job. The
  `HealAutoHandler` consumes heal jobs and proposes fixes via the BD
  `refactor_template` API without auto-approval -- the dashboard shows the
  diff for human review. Baselines update automatically after healthy runs.
- **Provisioning from the dashboard (landed Aug 22).** `POST
  /api/fleet/:storeId/provision` and `POST /api/fleet/provision` create Studio
  collectors from `collector-manifest.json` definitions. The Bright Data CLI
  is installed in the API Docker image for this purpose.
- **Parker's Pantry (live Aug 22).** `apps/pantry` at
  `pantry.spencerjireh.com` is the disclosed clone store for controlled
  break-and-heal demos (two storefronts: `/us` USD, `/ph` PHP).
- Not yet wired: the notifier module (scaffolded, no delivery channel).
