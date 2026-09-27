# Daily commands. `just` with no arguments lists them.
#
# These wrap the pnpm scripts rather than replacing them -- pnpm still works and
# turbo still owns the task graph. What this file adds is the handful of
# invocations that are easy to get wrong from memory.

# Local dev database, matching docker-compose.dev.yml.
LOCAL_DB := "postgres://basketwatch:basketwatch@localhost:5432/basketwatch"

# Where `just db-backup` files its dumps. Outside the repo on purpose: a
# `git clean -xdf` cannot take them, and no dump can ever reach a commit.
BACKUP_DIR := env_var('HOME') / "basketwatch-backups"

default:
    @just --list --unsorted

# DATABASE_URL is still passed inline below, even though the root .env now
# points at the local database too. Belt and braces: these recipes should not
# depend on what .env happens to hold today. To use prod data, name the file
# that has it:
#   set -a; . ./.env.prod; set +a; pnpm dev

# Contract watch + API on :3001 + dashboard on :3000 (local database)
dev:
    DATABASE_URL="{{LOCAL_DB}}" pnpm dev

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

# Everything CI runs -- .github/workflows/ci.yml is this list plus format:check
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

# DATABASE_URL is inline on purpose, so these never depend on .env contents.
# drizzle.config.ts also refuses a non-local host unless ALLOW_REMOTE_DB=1,
# which is the second lock on the same door.

# Apply migrations to the LOCAL database
db-migrate:
    DATABASE_URL="{{LOCAL_DB}}" pnpm db:migrate

# Diff schema.ts against the migration snapshot (expect "No schema changes")
db-generate:
    DATABASE_URL="{{LOCAL_DB}}" pnpm db:generate

# Drizzle Studio against the LOCAL database
db-studio:
    DATABASE_URL="{{LOCAL_DB}}" pnpm db:studio

# Backups. `pg_dump` is not installed on this machine, and a stock macOS one
# would be older than the server anyway -- so both recipes run it inside
# postgres:16-alpine, the exact image the deployment runs.
#
# Nothing prunes old dumps. They are single-digit MB, and deleting a backup is
# the one thing a backup recipe should never do.

# Dump the DEPLOYED database to $HOME/basketwatch-backups (read-only)
db-backup:
    #!/usr/bin/env bash
    set -euo pipefail

    # Over `ssh vps`, inside the postgres container. The public port only
    # admits the collector's host, and dumping through it from a laptop
    # stalled anyway. Needs the `vps` host in ~/.ssh/config.
    container="$(ssh -o BatchMode=yes vps \
        "docker ps --format '{{{{.Names}}' | grep '^postgres-1mzeirylwlx8ufqpfvwpb5db-' | head -n1")"
    if [ -z "$container" ]; then
        echo "error: no basketwatch postgres container on vps." >&2
        exit 1
    fi
    echo "dumping $container on vps"

    mkdir -p "{{BACKUP_DIR}}"
    out="{{BACKUP_DIR}}/basketwatch-$(date -u +%Y%m%dT%H%M%SZ).dump"

    # Written beside the final name and moved into place only once it verifies.
    # A redirect straight to $out would leave a plausible-looking empty file
    # behind whenever pg_dump fails.
    tmp="$out.partial"
    trap 'rm -f "$tmp"' EXIT

    ssh -o BatchMode=yes vps \
        "docker exec $container pg_dump -p 55432 -U basketwatch --format=custom --no-owner --no-privileges basketwatch" > "$tmp"

    # Prove the archive parses before calling it a backup: a size check passes
    # on a truncated dump, reading its table of contents does not.
    docker run --rm -v "$tmp:/dump:ro" --entrypoint sh postgres:16-alpine \
        -c 'exec pg_restore --list /dump' > /dev/null

    mv "$tmp" "$out"
    trap - EXIT
    echo "ok  $out  ($(du -h "$out" | cut -f1))"

# Restore a dump into the LOCAL database -- prod is not a reachable target
db-restore-local FILE:
    #!/usr/bin/env bash
    set -euo pipefail

    if [ ! -f "{{FILE}}" ]; then
        echo "error: no such dump: {{FILE}}" >&2
        exit 1
    fi

    if [ -z "$(docker compose -f docker-compose.dev.yml ps -q postgres)" ]; then
        echo "error: the local database is not running. Start it with: just up" >&2
        exit 1
    fi

    # --clean DROPS what is there now. The local database is not as throwaway
    # as its committed credentials suggest -- it accumulates scrapers, runs and
    # incidents that exist nowhere else -- so show the damage and ask first.
    echo "this will DROP and replace the local database. It currently holds:"
    docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U basketwatch -d basketwatch -tA \
        -c "select '  ' || relname || ': ' || n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by n_live_tup desc" \
        || echo "  (empty or not yet migrated)"
    read -r -p "type 'replace' to continue: " reply
    if [ "$reply" != "replace" ]; then
        echo "aborted -- nothing was changed" >&2
        exit 1
    fi

    # Piped through the dev container rather than `docker run`: it already has
    # pg_restore 16 and reaches the database on its own localhost, which avoids
    # the host.docker.internal detour Docker Desktop forces on macOS. This is
    # also why the connection is hardcoded and .env is never read here.
    docker compose -f docker-compose.dev.yml exec -T postgres \
        pg_restore --clean --if-exists --no-owner --no-privileges \
        -U basketwatch -d basketwatch < "{{FILE}}"

    echo "restored {{FILE}} into the local database"

# Remove build output and node_modules
clean:
    pnpm clean
