<img src="docs/brand/banner.png" alt="The Basketwatch mark, a price line that breaks where data is missing, next to the wordmark basketwatch." width="800">

# basketwatch

A grocery basket index whose promise is that it shows its own gaps. Prices come
from a fleet of scrapers; when one breaks, the index line stops rather than
interpolating over the missing days, and a heal loop repairs the scraper with
the whole attempt audited.

## Layout

```
apps/api        NestJS + Drizzle + pg-boss. Owns every read and write, incl. SSE.
apps/web        Next.js dashboard. A pure client of the API; never touches Postgres.
packages/contract   zod schemas and types. The only thing the two apps share.
packages/tsconfig   base / library / nest / next compiler configs.
packages/eslint-config  base / nest / next lint configs, incl. the import boundaries.
docs/           design docs, the deploy runbook, the API contract.
lab/            frozen exploration notebooks and the Bright Data credit guard.
                Not product code; nothing under apps/ or packages/ imports it.
```

Inside `apps/api/src`, `modules/` holds one directory per domain. The four
subsystems that are not built yet -- `pullers`, `heal`, `notifier`, and the
per-module `*.repository.ts` query layer -- already have their files and their
interfaces, so there is one obvious place for each to land.

## Commands

`just` is the entry point; run `just` on its own to list every recipe. Use
`just dev` rather than an app's own dev script: the API depends on the contract
package's watch build, and starting an app directly means contract edits stop
propagating.

```sh
pnpm install
just up             # local postgres
just dev            # contract watch + api :3001 + dashboard :3000
just check          # typecheck, lint, test, build
```

## Database

**`DATABASE_URL` in the repo-root `.env` points at the LOCAL database.** The
deployed one lives in `.env.prod`, which nothing loads by default — `just
db-backup` reads it, and otherwise you name it yourself. `drizzle.config.ts`
still refuses any non-local host unless you opt in explicitly, which is the
second lock on the same door:

```sh
# local dev -- the recipe passes the local URL for you
just db-migrate

# deployed, on purpose
ALLOW_REMOTE_DB=1 pnpm db:check
```

`apps/api/src/database/schema.ts` and `apps/api/drizzle/` were carried over
verbatim from the previous app, because they describe a live database holding
real data. Migration `0000` must keep its exact bytes: drizzle decides what to
apply from the journal's `when` timestamp, and re-running `0000` against
production fails on `CREATE VIEW "latest_price"`, which is the one statement in
that file without an `IF NOT EXISTS` guard.

## Things that will bite you

- **Do not run the API under `tsx`.** esbuild does not implement
  `emitDecoratorMetadata`, so NestJS injection silently hands every provider
  `undefined`. `pnpm dev` uses the real compiler for exactly this reason.
- **Do not enable `@typescript-eslint/consistent-type-imports` for the API.** Its
  autofix rewrites injected classes to `import type` and breaks DI the same way.
- **`API_INTERNAL_URL` is a build-time value for the dashboard image.** Next
  bakes `rewrites()` into the routes manifest during `next build`, so it is a
  Docker build arg, not a runtime env var.
- **Container healthchecks must use `127.0.0.1`, not `localhost`.** In the
  container `localhost` resolves to `::1` first and the server binds IPv4.
- `typescript` is pinned exactly. The latest major drops the decorator metadata
  emit that NestJS needs.

## The API seam

Nest sets a global `api` prefix with no exclusions, and the dashboard rewrites
`/api/:path*` straight through without stripping anything. The path is identical
everywhere:

| Where                  | URL                                       |
| ---------------------- | ----------------------------------------- |
| dev, direct            | `localhost:3001/api/health`               |
| dev, via the dashboard | `localhost:3000/api/health`               |
| prod, inside compose   | `api:3001/api/health`                     |
| prod, public           | `basketwatch.spencerjireh.com/api/health` |
