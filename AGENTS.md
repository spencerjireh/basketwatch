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
4. `docs/api-contract.md` — frozen endpoint and response shapes

## Layout

- `scrape-verse/` — the product monorepo (npm workspaces)
  - `apps/api` — orchestrator: NestJS + Drizzle + pg-boss (Postgres-backed
    job queue, no Redis); spider-sense validator in `src/validator/`
    (pure functions, keep them IO-free)
  - `apps/web` — dashboard (Vite + React + Recharts); currently on mock
    data in `src/data/mock.ts` that mirrors the API contract
  - `apps/clone-store` — "Parker's Pantry" chaos target (dependency-free
    node server, layout A/B mutation via authed POST /admin/layout)
  - `packages/shared` — fleet output contract (zod) + shared types
- `docs/` — all design docs and notes

## Commands

Run from `scrape-verse/`:

```sh
npm install
docker compose -f docker-compose.dev.yml up -d   # postgres only
npm run dev:api     # :3001
npm run dev:web     # :3000
npm run dev:clone   # :3002
npm test            # vitest (validator tests must stay green)
```

Deployment: `docker-compose.prod.yml` is THE Coolify deployment unit
(single Docker Compose resource; secrets via Coolify env vars). Never
deploy without the user's go-ahead.

Bright Data CLI (`brightdata`, v0.3.4+) drives Scraper Studio:
`scraper create <url> "<desc>"`, `scraper run <id> [url]`,
`scraper heal <id> "<prompt>" --auto-approve --auto-save`,
`scraper approve <id>`, `budget`.

## Hard rules

- **Never commit secrets.** `.env` is gitignored; keys live there only.
  Never print API keys in output, code, or the demo video.
- **Credits are finite (~$50 per account, and the team has two separate
 accounts — see `docs/index.md`).** Check `brightdata budget` before and
  after Studio-heavy work. Respect the budget-guard env knobs in
  `.env.example`. Do not create/run/heal scrapers in bulk without the
  user's go-ahead.
- **Bound every scraper.** Creation prompts must state the crawl scope
  explicitly ("this product page only", "front page only") — an unbounded
  description once crawled ~150 pages.
- **Public data only.** No login-walled, paywalled, or private sources
  (hackathon rule and house rule).
- **Kill only listeners.** Use `lsof -ti:PORT -sTCP:LISTEN | xargs kill` —
  a bare `lsof -ti:PORT` also matches browsers connected to the port.
- **Don't deploy** anything without the user's explicit go-ahead.
- The pre-build HN heal test is excluded from demo material (team decision).

## Conventions

- TypeScript everywhere; strict mode; match existing style (2-space,
  no semicolon changes, keep files small and typed).
- Validator checks stay pure and unit-tested; incidents must be replayable
  from stored `raw_output`.
- The API contract is frozen in `packages/shared/src/api.ts` and documented
  in `docs/api-contract.md`. The dashboard's mock data module holds fixtures
  in exactly those shapes — change the type and the fixture together, or
  neither.
- No emojis in code, docs, or output.

## Current state (update as things land)

- Scaffold complete on NestJS + pg-boss (swapped from Hono Aug 18, team
  decision); dashboard v1 on mock data; clone store working; dev/prod
  compose split with Dockerfiles for all three apps.
- API contract frozen Aug 18: shared types cover fleet, basket, feed,
  incidents, heal attempts and credit budget; `country` is a first-class
  dimension in the contract but not yet in the DB schema (gaps listed at the
  end of `docs/api-contract.md`).
- Not yet: DB wiring for ingest, heal orchestrator service, notifier,
  first deploy, real fleet (site vetting pending — PH gate Aug 19 EOD).
