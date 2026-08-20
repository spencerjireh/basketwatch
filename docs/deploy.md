---
title: Deploy runbook — Coolify
tags: [hackathon, ops]
created: 2026-08-20
status: v1
---

# Deploy runbook: Coolify

Companion to [architecture](architecture.md) section 3.6.

`docker-compose.prod.yml` **at the repo root** is the deployment unit. Coolify
watches `main` and redeploys the whole file on every push. Nothing is deployed
by hand, and nothing secret is committed.

## What is live today

Only `postgres`. It is published on a public port so both of us can write
scraped data into one database from our laptops while the rest of the app is
still being built.

`api` and `web` are defined in the same file but carry `profiles: ["app"]`, so
`docker compose up` neither builds nor starts them. A half-finished app build
therefore cannot take the database down with it. See
[Turning an app service on](#turning-an-app-service-on).

## Domains

| Host | Serves |
| --- | --- |
| `basketwatch.spencerjireh.com` | the dashboard (`web`) |
| `basketwatch.spencerjireh.com/api/*` | the API, same-origin — no separate host |
| `152.53.136.253:55432` | Postgres, raw TCP — a hostname will **not** work, see below |

The API deliberately has no host of its own. The `web` container is a Next.js
server that rewrites `/api/:path*` to `api:3001` **without stripping the
prefix**, because the API sets a global `api` prefix with no exclusions. The
path is therefore identical at every layer, which is why the Bright Data
webhook target is unchanged:
`https://basketwatch.spencerjireh.com/api/ingest/<scraper>`.

Two things this replaced, both worth knowing when the service is switched on:

- **The web container listens on 3000, not 80.** nginx is gone. Coolify's port
  setting has to match, or the proxy will route to a closed port.
- **`API_INTERNAL_URL` is a build argument, not a runtime variable.** Next
  evaluates `rewrites()` during `next build` and bakes the result into its
  routes manifest, so setting it on a running container does nothing. The
  compose file passes it under `build.args`.

A single-level subdomain is required for anything that needs TLS here: the
wildcard `*.spencerjireh.com` record and certificate does not cover a two-level
name like `store.basketwatch.spencerjireh.com`.

### Why Postgres listens on 55432 inside the container too

The VPS carries a `DOCKER-USER` rule that drops external traffic to container
port 5432:

```
-A DOCKER-USER ! -s 10.0.0.0/8 -p tcp -m tcp --dport 5432 -j DROP
```

It protects every Postgres container on the box, including another Coolify
database. Docker DNATs a published port *before* the FORWARD chain runs, so a
`55432:5432` mapping is still matched on the container-side port and dropped —
publishing on a non-standard host port does not dodge it.

So Postgres runs with `-p 55432` and the mapping is `55432:55432`. The rule
never matches, the firewall is untouched, every other database stays protected,
and the whole thing is declared in the repo instead of living in a root shell's
in-memory rule set.

The consequence to remember: inside the compose network the database is
`postgres:55432`, not `postgres:5432`. The `api` service's `DATABASE_URL`
already says so.

### Why Postgres uses the raw IP

`*.spencerjireh.com` is an A record to `152.53.136.253` with the Cloudflare
proxy **on**. The proxy carries HTTP and HTTPS only — it does not forward
arbitrary TCP — so `basketwatch.spencerjireh.com:55432` resolves to a
Cloudflare edge address that has no idea what Postgres is, and the connection
just hangs. The web hosts are unaffected; they are HTTP and want the proxy.

So database clients use the origin IP directly. The alternative — a DNS-only
`db.spencerjireh.com` record — would be a nicer name but would publish the
origin IP in public DNS, letting anyone bypass Cloudflare and reach the VPS on
any port. Not worth it for one week. If the VPS IP changes, update the
connection strings here and in `.env.example` at the repo root.

## First-time setup

### 1. Generate the database password

```sh
openssl rand -hex 32
```

Hex, not base64. Base64 emits `+`, `/`, and `=`, all of which need
percent-encoding inside a `postgres://user:pass@host` string — and the failure
looks exactly like a wrong password. 32 bytes of hex is 256 bits with nothing
to escape.

Keep it in a password manager. It goes into the Coolify env and nowhere else —
never into `.env.example`, a commit, or the demo video.

### 2. Create the Coolify resource

New project `basketwatch` -> **Docker Compose** resource, private repo through
the `spencers-test-app` GitHub App.

| Field | Value |
| --- | --- |
| Repository | `spencerjireh/scrape-verse-hackathon` |
| Branch | `main` |
| Base directory | `/` |
| Compose file | `docker-compose.prod.yml` — Coolify defaults this to `docker-compose.yml`, so it must be changed |
| Automatic Deployment | **on** — this is what redeploys on every push to `main` |

Environment variables:

| Name | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | the generated password. **Required** — the deploy fails loudly without it, by design |
| `POSTGRES_USER` | `basketwatch` (optional; this is the default) |
| `POSTGRES_DB` | `basketwatch` (optional; this is the default) |
| `POSTGRES_PORT_PUBLIC` | `55432` (optional; this is the default) |

Then deploy.

### 3. Confirm the port is reachable

Checked on Aug 20 and **no change was needed**: the VPS runs no `ufw`, its
`iptables` INPUT policy is `ACCEPT` with only a fail2ban rule on port 22, and
there is no cloud security group in front of it — ports 8000 and 22000 were
both reachable from outside during testing. The only thing that ever blocked
`55432` was the `DOCKER-USER` rule described above, which the internal-port
change sidesteps.

Re-check with this if a connection ever hangs:

```sh
ssh vps 'iptables -S DOCKER-USER; iptables -S INPUT'
```

Confirm from a machine that is not the VPS:

```sh
nc -vz 152.53.136.253 55432
```

## Connecting to the deployed database

```
postgres://basketwatch:<password>@152.53.136.253:55432/basketwatch
```

psql:

```sh
psql "postgres://basketwatch:<password>@152.53.136.253:55432/basketwatch"
```

DBeaver / TablePlus: host `152.53.136.253`, port `55432`,
database `basketwatch`, user `basketwatch`.

The database is **modelled**, not a dumping ground. `stores`, `products`,
`runs`, `price_observations`, `incidents`, `items` and `basket_map` are owned by
the Drizzle schema in `apps/api/src/database/schema.ts`; the migration in
`apps/api/drizzle/` is the only thing that should create tables. Write into the
existing tables — do not `df.to_sql()` a new one beside them, or the API will
not see your rows.

Identity is `(store_id, product_key)`. Prices are append-only in
`price_observations`, one row when a price first appears or moves, never one per
run; `latest_price` is the view that resolves the newest per product.

This database is on the public internet with password auth and nothing else in
front of it. That is a deliberate trade for hackathon speed. It holds public
grocery prices and no personal data — keep it that way, and rotate the
password after the hackathon.

## Local development

`docker-compose.dev.yml`, also at the repo root, runs Postgres alone on the
normal `5432` with throwaway `basketwatch` / `basketwatch` credentials. Apps
run on the host with hot reload.

```sh
docker compose -f docker-compose.dev.yml up -d   # from the repo root
cd basketwatch && pnpm dev
```

The two files pin different compose project names (`basketwatch-dev` and
`basketwatch-prod`), so their volumes and containers never collide even though
both files now sit in the same directory.

To exercise the prod file locally, give it a password — every `docker compose`
subcommand needs one, `ps` and `down` included, because the variable has no
default:

```sh
POSTGRES_PASSWORD=localtest docker compose -f docker-compose.prod.yml up -d postgres
```

A `.env` file at the repo root is the tidier way to do that repeatedly; it is
gitignored.

## Turning an app service on

1. Delete that service's `profiles: ["app"]` line in
   `docker-compose.prod.yml`.
2. Add whatever env vars it needs to the Coolify env — `api` needs
   `BRIGHTDATA_API_KEY`, `BRIGHTDATA_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`,
   and the alert keys, plus `OPS_TOKEN` for the endpoints that spend credits.
   The compose
   file uses `${VAR:-}` for these, so a missing one is an empty string rather
   than a failed deploy — check them rather than trusting a green deploy.
3. Set its domain in the Coolify UI, per the table above. `api` gets none.
4. Merge to `main`. Auto-deploy does the rest.

## Checking a deploy

In Coolify, or through the Coolify MCP tools: `list_deployments`, then
`get_deployment` with `include_log_summary=true`. `get_logs` only works while
a resource is running.

## Known rough edge

Coolify parses the compose file itself before handing it to Docker. Compose
profiles are standard and `docker compose up` honours them, but if a deploy
ever shows Coolify building `api` / `web` despite the profile,
the fallback is to comment those three services out entirely and keep the same
turn-it-on note. That is one commit, not a redesign.
