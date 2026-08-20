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

`api`, `web`, and `clone-store` are defined in the same file but carry
`profiles: ["app"]`, so `docker compose up` neither builds nor starts them. A
half-finished app build therefore cannot take the database down with it. See
[Turning an app service on](#turning-an-app-service-on).

## Domains

| Host | Serves |
| --- | --- |
| `basketwatch.spencerjireh.com` | the dashboard (`web`) |
| `basketwatch.spencerjireh.com/api/*` | the API, same-origin — no separate host |
| `parkers-pantry.spencerjireh.com` | the clone store, the chaos target |
| `<vps-ip>:55432` | Postgres, raw TCP — a hostname will **not** work, see below |

The API deliberately has no host of its own. The `web` container's nginx
proxies `/api/` to `api:3001` and strips the prefix
(`scrape-verse/apps/web/nginx.conf`), which keeps the dashboard same-origin and
means no CORS config. The Bright Data webhook target is therefore
`https://basketwatch.spencerjireh.com/api/ingest/<scraper>`.

`parkers-pantry` is a single-level subdomain on purpose. A wildcard
`*.spencerjireh.com` record and certificate does not cover a two-level name
like `store.basketwatch.spencerjireh.com`.

### Why Postgres uses the raw IP

`*.spencerjireh.com` is an A record to `<vps-ip>` with the Cloudflare
proxy **on**. The proxy carries HTTP and HTTPS only — it does not forward
arbitrary TCP — so `basketwatch.spencerjireh.com:55432` resolves to a
Cloudflare edge address that has no idea what Postgres is, and the connection
just hangs. The web hosts are unaffected; they are HTTP and want the proxy.

So database clients use the origin IP directly. The alternative — a DNS-only
`db.spencerjireh.com` record — would be a nicer name but would publish the
origin IP in public DNS, letting anyone bypass Cloudflare and reach the VPS on
any port. Not worth it for one week. If the VPS IP changes, update the
connection strings here and in `scrape-verse/.env.example`.

## First-time setup

### 1. Generate the database password

```sh
openssl rand -base64 32
```

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

### 3. Open the port on the host

Publishing `55432` in compose only opens it as far as the Docker host. If the
VPS runs a firewall or sits behind a cloud security group, the port has to be
allowed there too, or connections from outside will simply hang with nothing
useful in any log.

```sh
sudo ufw allow 55432/tcp    # if the VPS uses ufw
```

Confirm from a machine that is not the VPS:

```sh
nc -vz <vps-ip> 55432
```

## Connecting to the deployed database

```
postgres://basketwatch:<password>@<vps-ip>:55432/basketwatch
```

psql:

```sh
psql "postgres://basketwatch:<password>@<vps-ip>:55432/basketwatch"
```

DBeaver / TablePlus: host `<vps-ip>`, port `55432`,
database `basketwatch`, user `basketwatch`.

Python, for dumping scraped rows:

```python
from sqlalchemy import create_engine
engine = create_engine(
    "postgresql+psycopg://basketwatch:<password>@<vps-ip>:55432/basketwatch"
)
df.to_sql("raw_prices", engine, if_exists="append", index=False)
```

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
cd scrape-verse && npm run dev:api
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
   and the alert keys; `clone-store` needs `CLONE_ADMIN_TOKEN`. The compose
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
ever shows Coolify building `api` / `web` / `clone-store` despite the profile,
the fallback is to comment those three services out entirely and keep the same
turn-it-on note. That is one commit, not a redesign.
