# HLD: Self-Healing Price Tracker ("Into the Scrape-Verse" 2026)

Status: draft v1 for team review. Aug 15, 2026.
Companion: `hackathon-brief.md` (rules, judging, experiment findings).
Diagrams: `diagrams/*.png` (sources in `*.mmd`).

## 1. One-liner

A US/global grocery/staples price tracker whose scraper fleet cannot silently
die: a "spider-sense" layer detects breakage from output anomalies, an AI heal
orchestrator repairs scrapers autonomously through Bright Data Scraper Studio,
and every repair is verified and audited. Framing (product-first vs
devtool-first) deliberately deferred to demo prep.

## 2. Goals / non-goals

Goals
- Fleet of 4-6 Studio scrapers over structurally different store sites, plus
  one self-hosted clone store used as a controlled chaos target.
- Autonomous detect -> diagnose -> heal -> verify -> approve loop with a
  complete audit trail (evidence, prompt, diff, verdict, credits).
- Public dashboard: basket index over time, per-store/per-product prices,
  fleet health board, heal audit timeline.
- Alerts: price drops (product) and breakage/heal events (ops) via Resend
  email + Telegram; Discord if time allows.
- Deployed live on the Coolify VPS; judges click a URL.

Non-goals (explicitly out)
- User accounts / auth of any kind.
- Philippines site coverage.
- Human approval gates in the heal loop (auto-approve with audit instead).
- Scraping anything login-walled, paywalled, or private (hackathon rule).

## 3. Component overview

See `diagrams/system-architecture.png`.

### 3.1 Scraper fleet (Bright Data Scraper Studio)
- One scraper per target site, AI-generated via `automate_template`, saved to
  production. Uniform output contract per scraper:
  `[{ product_key, name, price, currency, unit, in_stock, url, observed_at }]`.
- Delivery: webhook to our ingest endpoint (validated by shared secret);
  fallback: poll `/dca/get_result`.
- Canary runs: same scraper, `--sync`/trigger_immediate against 1 URL, used
  only for verification after heals.

### 3.2 Orchestrator API (Node/TypeScript)
Single service, modular internals. Why TS: Studio scraper code is JS, one
language across scrapers/backend/frontend serves the clean-code track.

- **Scheduler**: node-cron; 2 scheduled fleet runs/day + manual trigger from
  ops UI. Jitter between scrapers to spread load.
- **Ingest**: webhook receiver; verifies signature, stores raw run, enqueues
  validation.
- **Spider-Sense validator** (pure functions, unit-tested — this is the
  technical heart):
  1. JSON Schema validation (hard fail)
  2. Row-count anomaly vs baseline expected count (hard fail if < 40%)
  3. Field null-rate spike vs rolling baseline (e.g. price null-rate jumps
     from 2% to 60%)
  4. Value drift: per-field p5/p95 envelope; flag runs where >50% of prices
     fall outside, or store-level median jumps >30% run-over-run
  5. Freshness: expected delivery missed by >2h
  - Soft anomaly -> `suspect` (stored, flagged, excluded from baselines);
    confirmed/hard -> `broken` + incident. See
    `diagrams/health-state-machine.png`.
- **Heal orchestrator** (see `diagrams/heal-loop-sequence.png`):
  - Builds evidence bundle: failing checks, sample bad output, last-good
    sample, field-level diff summary.
  - Claude API turns evidence into a plain-language heal prompt (Studio's
    docs recommend small, specific prompts — one field at a time).
  - Calls `refactor_template`, polls; on `awaiting_approval` calls
    `resume_automation_job` (approve) -> canary run -> re-validate.
  - Pass: save to production, close incident, ops alert "healed".
  - Fail: reject, retry with refined prompt (max 3 attempts), then escalate
    to `manual_attention`.
  - **Budget guard**: per-scraper daily heal cap + global daily credit
    ceiling; guard checked before every Studio call. (Protects the $50.)
- **Notifier**: one interface, three adapters (Resend, Telegram, Discord).
  Product alerts (price drop >X% on basket item) and ops alerts (breakage,
  healed, escalation).

### 3.3 Datastore (Postgres 16)
Schema in `diagrams/data-model.png`: `scrapers`, `runs`, `baselines`,
`price_records`, `products`, `incidents`, `heal_attempts`, `alerts`.
Drizzle ORM + migrations. Raw run payloads kept (jsonb) so incidents can be
replayed/re-validated during development.

### 3.4 Dashboard (React + Vite + Tailwind + shadcn/ui, Recharts)
- **Public**: basket index line (the hero chart — gaps visualize breakage,
  heals close the line), per-product store comparison, price-drop feed.
- **Ops ("web" view)**: fleet health board (state machine per scraper),
  incident timeline, heal audit viewer showing evidence -> prompt -> Studio
  diff -> verdict, credit spend meter.
- SPA + REST is enough; SSE for live run status if time allows.

### 3.5 Clone store ("chaos target")
Static store page (10 basket products) served on a subdomain of the VPS with
`?layout=b` / env-flag mutation: renames CSS classes, moves price into a
nested span, switches price format. Purpose: scripted, guaranteed
break-and-heal demo moment + integration-test target during development.
Disclosed as a test target in the submission.

### 3.6 Deployment (see `diagrams/deployment.png`)
Coolify VPS, docker compose stack: `dashboard`, `orchestrator-api`,
`postgres` (volume), `clone-store`. Coolify handles TLS/subdomains. Secrets
(Bright Data key, Anthropic key, Resend, Telegram token, webhook secret) via
Coolify env vars. Bright Data webhook -> `https://api.<domain>/ingest/<scraper>`.

## 4. External interfaces

| Interface | Direction | Notes |
|---|---|---|
| `api.brightdata.com /dca/*` | out | trigger, get_result, refactor_template, resume_automation_job |
| Studio webhook delivery | in | signed; per-scraper path |
| Anthropic API | out | evidence -> heal prompt; also breakage classification |
| Resend / Telegram / Discord | out | notifier adapters |
| Public REST `/api/*` | in | dashboard reads; manual trigger (unauthenticated but rate-limited, mutation endpoints behind a simple token) |

## 5. Feature split (2 devs, by vertical slice)

- **Slice 1 — data plane**: scrapers, ingest, validator, DB, baselines.
- **Slice 2 — control plane + UI**: heal orchestrator, notifier, dashboard,
  clone store, deploy.
Swap freely; both slices meet at the `runs`/`incidents` tables and the REST
API contract (defined day 1).

## 6. Day plan (Aug 17-23)

| Day | Milestone |
|---|---|
| Sun 17 | Repo scaffold, compose stack deployed skeleton, DB schema, clone store live, first 2 Studio scrapers (clone + 1 real), ingest storing runs |
| Mon 18 | Validator + state machine complete w/ unit tests; 4+ scrapers; baselines forming |
| Tue 19 | Heal orchestrator end-to-end against clone store (the make-or-break day) |
| Wed 20 | Dashboard core: hero chart, fleet board, incident/heal views; notifier (Resend + Telegram) |
| Thu 21 | Polish UI, framing decision (product vs devtool pitch), hardening, remaining scrapers |
| Fri 22 | Demo video, README, Scraper Studio usage writeup, submission draft |
| Sat 23 | Buffer + submit |

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Account verification not approved | No AI create/heal at all | Emailed WeMakeDevs Aug 15; escalate via Zendesk; fallback: hand-written scrapers in Studio IDE (execution is not gated) + heal loop demo deferred |
| Real store sites block/return junk | Weak product data | Bright Data unlocker infra mitigates; vet 8-10 candidate sites day 1, keep best 4-6; clone store guarantees demo |
| Heal quality is poor on real breakage | Loop demo fails on real sites | Clone store gives controlled reproducible case; refine prompts (one field at a time per BD docs) |
| Credit burn (heals cost unknown) | Dead account mid-week | Budget guard before every Studio call; measure heal cost Tue and recalibrate caps |
| Studio heal latency (up to 15 min) | Sluggish live demo | Demo uses pre-recorded heal + live dashboard state; video shows real-time timeline |

## 8. Open questions for the team

1. Which real store sites? (I'll vet a candidate list — need structurally
   diverse, public, stable product pages: e.g. a big-box store, a pharmacy,
   a regional grocer, an electronics retailer as an outlier item.)
2. Basket contents: ~10 staples (eggs, milk, bread, rice, coffee, sugar,
   chicken, oil, pasta, bananas)? Adjust freely.
3. Names: engine codename + product name (Spider-Man theming encouraged by
   the tracks). Decide with framing on Thu, but a repo name is needed Sun.
4. Next.js vs Vite SPA for the dashboard — either fine on Coolify; default
   is Vite SPA unless someone feels strongly.
