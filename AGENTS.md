# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this repo is

Team entry for the WeMakeDevs "Into the Scrape-Verse" hackathon
(Aug 17-23, 2026): a self-healing grocery price tracker built on Bright
Data Scraper Studio. This repo is the private lab notebook AND the
codebase — docs, experiments, and product code live together. A scrubbed
public repo may be split out for submission near the deadline.

Read the doc that matches the work, not all of them:

- Scoping a feature or judging demo value: `docs/hackathon-brief.md`
  (rules, judging criteria), then `docs/prd.md` (scope, cut order).
- Adding or wiring an API module: `docs/architecture.md` (HLD; diagrams
  in `docs/diagrams/`).
- Touching `packages/contract` or endpoint shapes: `docs/api-contract.md`.
- Anything that spends Bright Data credits: `docs/credit-monitoring.md`
  (also a hard rule below).
- Provisioning Studio collectors: `docs/collector-manifest.json` (canonical
  definitions for all 16 stores) and `docs/collector-runbook.md` (step-by-step
  procedure).
- Status and open team decisions: `docs/index.md`.

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
- `docs/` — all design docs and notes.
- `lab/` — not product code. Nothing under `apps/` or `packages/` imports from
  it, and its dependencies are installed locally to each notebook:
  - `lab/spencer-exploration/` — Python: site discovery and scoring
    (`registry.json`, `fleet.lock.json`), the catalogue puller and its SQLite
    store, Studio transport. Start at its `HANDOFF.md` — it states what the app
    has to absorb. **Frozen**: kept as documentation, nothing new written there.
  - `lab/edjin-exploration/` — Node: browser-based site vetting (`vet.mjs`,
    `vet.json`), the second pass that catches client-rendered stores the HTTP
    pass misses.
  - `lab/scripts/bd.mjs` — the guarded Bright Data wrapper (see Hard rules).
    Reachable as `just guard`.

Findings graduate from `lab/` into `docs/` and, when they change the contract,
into a PR against the workspace.

Not built yet: the clone store (demo prop for staged break-and-heal),
the notifier module.

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
just guard --report # Bright Data spend
```

Run `just dev`, not an app's own dev script: the API depends on the contract
package's watch build, and starting an app alone means contract edits stop
propagating.

**`DATABASE_URL` in the root `.env` points at the deployed database**, so a bare
`pnpm db:migrate` would target production. `drizzle.config.ts` refuses a
non-local host unless you pass `ALLOW_REMOTE_DB=1`. The `just db-*` recipes pass
the local URL inline, which is the whole reason they exist. Migration `0000`
must keep its exact bytes — see the README.

Deployment: root `docker-compose.prod.yml` is THE Coolify deployment unit
(single Docker Compose resource watching `main`; secrets via Coolify env
vars). All three services deploy: `postgres`, published on port `55432` for
the team to write scraped data into, plus `api` and `web`. `web` binds
**3000**, not 80, and `API_INTERNAL_URL` is a Docker build arg rather than a
runtime variable. The API applies pending migrations itself on boot, ahead of
the queue and the first request — a Coolify deploy has no step where a human
runs drizzle-kit. Runbook:
[docs/deploy.md](./docs/deploy.md). Never deploy without the user's go-ahead.

Bright Data CLI (`brightdata`, v0.3.4+) drives Scraper Studio:
`scraper create <url> "<desc>"`, `scraper run <id> [url]`,
`scraper heal <id> "<prompt>" --auto-approve --auto-save`,
`scraper approve <id>`, `budget`.

## Hard rules

- **Never commit secrets.** One `.env` for the whole repo, at the repo **root**,
  beside `.env.example` and the compose files. It is gitignored; keys live there
  only, and there is no per-app copy. Never print API keys in output, code, or
  the demo video.
- **Credits are finite (~$50 per account, and the team has two separate
  accounts — see `docs/index.md`).** Never call the Bright Data CLI
  directly for anything that spends: go through the guarded wrapper,
  `node lab/scripts/bd.mjs --label=<what> -- <brightdata args>` on the Node
  side, or `studio.py`'s `Guard` on the Python side. Both enforce the same
  caps from `.env.example`, both check before and meter after (including
  timeouts), and both exit non-zero on a breach. The unified protocol is in
  [credit monitoring](./docs/credit-monitoring.md) — read it before any
  credit-spending work. Paste your guard's report in every PR that spends.
  Raise a cap deliberately, never silently. Do not create/run/heal scrapers
  in bulk without the user's go-ahead.
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

Snapshot, accurate as of Aug 22. Fuller status, spend, and the open team
decisions live in [docs/index.md](./docs/index.md) — update that file as
things land, and this list only when a line here becomes false.

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
  live in `docs/collector-manifest.json`; the setup procedure is in
  `docs/collector-runbook.md`.
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
- Not yet: the notifier, the clone store (demo prop for staged break-and-heal).
