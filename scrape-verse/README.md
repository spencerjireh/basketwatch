# scrape-verse (working name)

Self-healing price tracker for the WeMakeDevs "Into the Scrape-Verse"
hackathon (Aug 17-23, 2026). A fleet of Bright Data Scraper Studio scrapers
feeds a basket-price dashboard; a "spider-sense" layer detects silent
breakage, and a heal orchestrator repairs scrapers autonomously with a full
audit trail.

Design docs live in `../docs/` (architecture.md, hackathon-brief.md,
diagrams/).

## Layout

- `apps/api` — orchestrator: jobs, webhook ingest, spider-sense
  validator, heal orchestrator, notifier (NestJS + Drizzle + pg-boss +
  Postgres)
- `apps/web` — dashboard (React + Vite)
- `apps/clone-store` — "Parker's Pantry", the controlled chaos target with a
  layout-mutation switch (dependency-free node server)
- `packages/shared` — fleet output contract (zod) + shared types

## Dev

```sh
npm install
docker compose -f docker-compose.dev.yml up -d   # postgres only
cp .env.example .env   # fill in keys
npm run dev:api        # :3001
npm run dev:web        # :3000
npm run dev:clone      # :3002
npm test
```

## Deploy

`docker-compose.prod.yml` is the deployment unit: Coolify runs it as a
single Docker Compose resource (postgres internal-only, secrets from
Coolify env vars). Dev runs only postgres in Docker; apps run on the host
with hot reload.

## Rules kept

- Public data only; no login/paywalled scraping.
- Secrets stay in `.env` (gitignored). Never commit or show tokens in demos.
