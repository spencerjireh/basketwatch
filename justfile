# Daily commands. `just` with no arguments lists them.
#
# These wrap the pnpm scripts rather than replacing them -- pnpm still works and
# turbo still owns the task graph. What this file adds is the handful of
# invocations that are easy to get wrong from memory.

# Local dev database, matching docker-compose.dev.yml.
LOCAL_DB := "postgres://basketwatch:basketwatch@localhost:5432/basketwatch"

default:
    @just --list --unsorted

# Contract watch + API on :3001 + dashboard on :3000
dev:
    pnpm dev

# Build every workspace
build:
    pnpm build

# Vitest, via turbo
test:
    pnpm test

# ESLint, via turbo
lint:
    pnpm lint

# tsc --noEmit, via turbo
typecheck:
    pnpm typecheck

# Everything CI would run, if there were CI
check: typecheck lint test build

# Prettier over apps/ and packages/ only -- see .prettierignore
format:
    pnpm format

# Start the local Postgres
up:
    docker compose -f docker-compose.dev.yml up -d

# Stop the local Postgres (add -v yourself to drop the volume)
down:
    docker compose -f docker-compose.dev.yml down

# DATABASE_URL is inline on purpose. The repo-root .env points at PRODUCTION,
# and drizzle.config.ts refuses a non-local host -- so without this, the honest
# first attempt is the one that gets refused. Make the safe path the easy one.

# Apply migrations to the LOCAL database
db-migrate:
    DATABASE_URL="{{LOCAL_DB}}" pnpm db:migrate

# Diff schema.ts against the migration snapshot (expect "No schema changes")
db-generate:
    DATABASE_URL="{{LOCAL_DB}}" pnpm db:generate

# Drizzle Studio against the LOCAL database
db-studio:
    DATABASE_URL="{{LOCAL_DB}}" pnpm db:studio

# Guarded Bright Data CLI -- everything that spends credits goes through this.
# Examples:
#   just guard --report
#   just guard --label=vet-us -- scrape https://example.com --country us

# Guarded Bright Data CLI (see lab/scripts/bd.mjs)
guard *ARGS:
    node lab/scripts/bd.mjs {{ARGS}}

# Remove build output and node_modules
clean:
    pnpm clean
