# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this repo is

Team entry for the WeMakeDevs "Into the Scrape-Verse" hackathon
(Aug 17-23, 2026): a self-healing grocery price tracker built on Bright
Data Scraper Studio. This repo is the private lab notebook AND the
codebase — docs, experiments, and product code live together. A scrubbed
public repo may be split out for submission near the deadline.

Read these before doing product work, in order:

1. `docs/hackathon-brief.md` — rules, judging criteria, experiment findings
2. `docs/prd.md` — confirmed scope, cut order, definition of done
3. `docs/architecture.md` — HLD; diagrams in `docs/diagrams/`
4. `docs/api-contract.md` — v2 endpoint and response shapes (zod, in `packages/contract`)

## Layout

The repo root **is** the product monorepo (pnpm workspaces + Turborepo). There
is no app subdirectory; `apps/` and `packages/` sit beside the compose files.

- `apps/api` — orchestrator: NestJS + Drizzle + pg-boss (Postgres-backed job
  queue, no Redis). One directory per domain under `src/modules/`. Only
  `*.repository.ts` may touch the Drizzle schema; a lint rule enforces it. The
  spider-sense validator in `modules/validator/checks.ts` stays pure and IO-free.
- `apps/web` — dashboard (Next.js App Router + Tailwind + Recharts, no component
  library). A pure client of the API: it never touches Postgres, and a lint rule
  enforces that too. Currently on `src/fixtures/dashboard.ts`, typed by the
  contract so the swap to fetch calls changes no types.
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

Not built yet, each with its home already in the tree: the per-module
`*.repository.ts` query layer, `modules/pullers/`, `modules/heal/`,
`modules/notifier/`.

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
vars). Only `postgres` deploys today — it is published on port `55432` for
the team to write scraped data into, while `api` and `web` sit behind the `app`
compose profile and are never built. When `web` is switched on, its port is
**3000**, not 80, and `API_INTERNAL_URL` is a Docker build arg rather than a
runtime variable. Runbook:
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
  `docs/api-contract.md`. The dashboard's fixtures are typed by those schemas —
  change the schema and the fixture together, or neither.
- Money is `{ amount, currency }`, never a preformatted string and never two
  sibling fields. Timestamps are ISO 8601 UTC strings. `country` appears on
  every store-, product- and basket-shaped payload.
- Do not run the API under `tsx`, and do not enable
  `@typescript-eslint/consistent-type-imports` for it: esbuild has no
  `emitDecoratorMetadata`, and the lint autofix strips the value imports Nest
  needs, so both break dependency injection silently.
- No emojis in code, docs, or output.

## Current state (update as things land)

- **Rebuilt Aug 20.** `scrape-verse/` was replaced by `basketwatch/` on pnpm +
  Turborepo, NestJS + Next.js. The old app was a scaffold nothing connected: the
  database client was never imported, the job producer never called, no
  controller touched Postgres. Only the Drizzle schema and migration 0000 were
  carried over, because they describe the live database.
- The clone store was deleted with the old app and will be rebuilt from scratch
  once there is a demoable product to break.
- The API contract was rewritten as zod schemas. Endpoints are unchanged in
  spirit and now sit under a global `/api` prefix with no exclusions; the
  dashboard rewrites `/api/*` straight through, so the Bright Data webhook URL
  did not change. Feed and incidents are cursor-paginated from day one.
- Both compose files live at the repo root, and the DB role and database are
  `basketwatch`; re-create your local volume
  (`docker compose -f docker-compose.dev.yml down -v`) or auth will fail.
- `catalogue.db` migrated into Postgres Aug 20. The data plane is the catalogue
  shape - `stores`, `products` keyed `(store_id, product_key)`, `runs`,
  `price_observations`, `items`, `basket_map`, and the `latest_price` view -
  alongside the control plane (`scrapers`, `baselines`, `heal_attempts`,
  `alerts`). Migration 0000 was rewritten rather than layered, so reset your dev
  volume. `lab/spencer-exploration/to_postgres.py` is the one-time loader;
  `catalogue.db` stays in git, frozen as documentation. The Python pullers still
  write SQLite - nothing writes Postgres yet.
- Coolify deploy scaffolded Aug 20 on `basketwatch.spencerjireh.com`: the
  root prod compose ships a public Postgres for the team to dump scraped data
  into; `api` and `web` are profile-gated and still not deployed. The Coolify
  resource itself is created by hand — see `docs/deploy.md`.
- Not yet: any endpoint that reads the database (every dashboard route returns
  501 today, and the dashboard runs on fixtures), DB wiring for ingest, the
  heal orchestrator, the notifier, the TypeScript pullers, app services live on
  the deploy. Each has a named home in the tree.
- Migration 0001, when someone writes it: add `attempt`, `started_at`,
  `finished_at`, `canary` to `heal_attempts`; move per-store crawl config out of
  `lab/spencer-exploration/fleet.lock.json` onto `stores`/`scrapers`; normalise
  `runs.status` from `anomalous|error` to `suspect|broken` and drop the read
  mapper.
