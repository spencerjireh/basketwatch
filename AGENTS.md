# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this repo is

A grocery basket index for the Philippines: a fifteen-staple basket priced in
every store, over shelf prices a separate private service collects into the
same Postgres database. This repo is the read side: a read-only API and the
dashboard. It holds no collection code and must not name where or how prices
are collected (endpoints, request headers, schedule, User-Agent).

Read the doc that matches the work, not all of them:

- Adding or wiring an API module: `docs/architecture.md` (HLD; diagrams
  inline as mermaid).
- Touching `packages/contract` or endpoint shapes: `docs/api-contract.md`.

## Layout

The repo root **is** the product monorepo (pnpm workspaces + Turborepo). There
is no app subdirectory; `apps/` and `packages/` sit beside the compose files.

- `apps/api` — NestJS + Drizzle, read-only. One directory per domain under
  `src/modules/`. Only `*.repository.ts` may touch the Drizzle schema; a lint
  rule enforces it. It owns the schema and applies migrations on boot.
- `apps/web` — dashboard (Next.js App Router + Tailwind, no component
  library). A pure client of the API: it never touches Postgres, and a lint rule
  enforces that too.
- `packages/contract` — zod schemas and types. The only thing the two apps
  share, and the reason the boundary above holds.
- `packages/tsconfig`, `packages/eslint-config` — shared configs.
- `docs/` — design docs (`architecture.md`, `api-contract.md`) and brand
  assets.

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
unless you pass `ALLOW_REMOTE_DB=1`. `0000_baseline` stands for the old
0000-0015 chain and carries its last timestamp; new migrations get a later
`when` — see the README.

To restore a production dump into the local database for testing:
`just db-backup`, then `just db-restore-local <file>`.

Deployment: root `docker-compose.prod.yml` is THE deployment unit
(single Docker Compose resource watching `main`; secrets via deploy-time env
vars). Three services deploy: `postgres`, published on port `55432` for the
collector to write into, plus `api` and `web`. `web` binds **3000**, not 80,
and `API_INTERNAL_URL` is a Docker build arg rather than a runtime variable.
The API serves requests as `bw_api` (read-only) and applies pending
migrations on boot as the owner role (`MIGRATION_DATABASE_URL`), ahead of the
first request. Never deploy without the user's go-ahead.

## Hard rules

- **Never commit secrets.** Two files, both at the repo **root**, beside
  `.env.example` and the compose files: `.env` for what you are working against
  (local by default) and `.env.prod` for the deployed database, loaded only when
  named. Both are gitignored. There is still no per-app copy — that rule is
  about apps, not about these two. Never print API keys in output or code.
- **The API stays read-only.** No write endpoints, no job queue, no
  collection code. Writes belong to the private collector.
- **No collection detail in this repo.** Store endpoints, request headers,
  the pull schedule and the User-Agent live in the private collector, not in
  code, migrations, docs or commit messages here.
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
  Migrations: `0000_baseline`.
- The API is read-only: basket, products, fleet, feed, incidents, health.
  Runs, observations and incidents are written by the private collector.
- **Philippines only.** The contract lists one country. US store rows from
  the project's first weeks stay in the database with `active = false` and
  keep their history; every read that joins `stores` filters on `active`.
