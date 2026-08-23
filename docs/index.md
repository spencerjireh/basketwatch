---
title: Scrape-Verse Vault
tags: [hackathon, moc]
created: 2026-08-18
---

# Scrape-Verse — map of content

Team notebook for the WeMakeDevs "Into the Scrape-Verse" hackathon
(Aug 17-23, 2026). Open this `docs/` folder as an Obsidian vault or read it
on GitHub — everything renders in both.

## Read in this order

1. [Hackathon brief](hackathon-brief.md) — rules, judging criteria, all
   experiment findings, week-at-a-glance gantt. Living notes; newest
   findings on top of the findings sections.
2. [PRD](prd.md) — confirmed product scope, decisions, cut order,
   candidate sites, definition of done.
3. [Architecture (HLD)](architecture.md) — components, self-heal loop,
   state machine, data model, deployment; all diagrams inline.
4. [API contract](api-contract.md) — v2 endpoint and response shapes; the seam
   the data plane and control plane meet at.
5. [Deploy runbook](deploy.md) — the Coolify resource, the domains, and how to
   connect to the deployed Postgres.
6. [Credit monitoring](credit-monitoring.md) — what Bright Data will and
   will not tell us about spend, the guarded wrapper every spending command
   goes through, and the caps. Read before running anything that costs.
7. [Site vetting](site-vetting.md) — the browser pass over the sites the
   registry could only reach through the Unlocker, and what it changes.
   The fleet decision itself lives in `lab/spencer-exploration/fleet.lock.json`.

## Elsewhere

- [AGENTS.md](../AGENTS.md) — instructions for AI coding agents (CLAUDE.md
  points here). Hard rules: secrets, credit budget, bounded scrapers.
- `diagrams/` — `.mmd` sources and PNG exports of the HLD diagrams; the
  inline mermaid in [architecture](architecture.md) is the same content.
- `reference/` — vendored third-party docs, not team writing: Bright Data's
  official hackathon repo, split into
  [agent prompts](reference/brightdata-agent-prompts.md) (build, run, heal,
  approve, batch) and [demo ideas](reference/brightdata-demo-ideas.md)
  (target-selection gates). Re-fetch from source rather than editing by hand.
- Code: `apps/` and `packages/` at the repo root (see the [README](../README.md)).
- Lab notebooks, one per person, kept out of the product tree:
  [spencer-exploration](../lab/spencer-exploration/README.md) (Python; site
  registry, fleet lock, catalogue puller, Studio transport — its
  [HANDOFF](../lab/spencer-exploration/HANDOFF.md) states what the app must
  absorb) and [edjin-exploration](../lab/edjin-exploration/README.md) (Node;
  browser-based vetting).
- [Heal agent proposal](plans/heal-agent-proposal.md) -- Edjin, Aug 20. Extends the
  heal orchestrator into one agent covering scraper repair *and* data quality,
  grounded in eight false basket pins found in the live data. **Draft, pending
  team review** -- read it before building anything under `modules/heal/` or
  `modules/quality/`, but it is a proposal, not confirmed scope.
- [Heal integration plan](plans/heal-integration-plan.md) -- Edjin, Aug 21.
  The phased pipeline plan for wiring post-pull validation, dashboard health
  section, and LLM triage. Built on Phase 1 test findings.
- [Heal test findings](../lab/edjin-exploration/heal-test-findings.md) --
  Phase 1 integration test results: Sukli vs Dierbergs, generic vs LLM-style
  prompts, triage gap analysis.
- [Heal prompt experiments](../lab/edjin-exploration/heal-prompt-experiments.md) --
  original experiment plan for prompt effectiveness testing.
- Review artifacts (shareable pages):
  - HLD: https://claude.ai/code/artifact/a6c6e40f-22be-4b1d-b8f7-2c3f08578463
  - PRD: https://claude.ai/code/artifact/f7cf34cf-af6e-4efd-8f76-16dd1865ef36

## Standing status

This section is the single status home: update it as things land. AGENTS.md
keeps only a short snapshot and points here.

- **The app is `basketwatch`** (pnpm + Turborepo, NestJS + Next.js), rebuilt
  Aug 20 from `scrape-verse/`; only the Drizzle schema and migration 0000
  carried across. The clone store — still the required demo centrepiece — is
  rebuilt **last**, after ingest and the heal loop (team decision Aug 20,
  closes C7).
- **Data is in prod.** 19 stores, 28,378 products, 28,376 price observations,
  340 basket pins, 21 items. Real history is two days, Aug 19-20, holding 30
  actual price moves. **The schedule has in fact been running since Aug 21** --
  see the correction below.
- **The read path landed Aug 20.** Every dashboard route answers from Postgres
  and the fixtures are deleted. The basket index reads as an as-of query over
  change-only history, and a day missing any core item totals `null` — the gap
  the chart draws rather than interpolating across.
- **The puller engine landed Aug 21**, ported from `catalogue.py`.
- **The schedule was never actually disarmed** (found Aug 23). `PULL_SCHEDULE_ENABLED`
  was read with `z.coerce.boolean()`, which is `Boolean(v)` -- and `Boolean("false")`
  is `true`. Prod compose passes `${PULL_SCHEDULE_ENABLED:-false}`, always a
  non-empty string, so every deploy armed the 06:00 UTC cron. It fired on Aug 21
  and Aug 22, writing 32 runs with `trigger = 'cron'`. Flags are read as words
  now (`true/1/yes/on`), with a test for the exact case that fooled us. The
  schedule is **deliberately left on**, set in Coolify rather than by accident.
- **Manual and scheduled pulls are one path** (Aug 23). A wet
  `POST /api/pullers/:storeId/run` enqueues onto the same queue the cron uses
  and answers with a job id; only a dry run still executes inline. Validation is
  enqueued by the run itself rather than by whoever was watching the dashboard.
- **Heal phases 1-2 landed Aug 22** (PRs #20, #21, #24): `modules/heal/` holds
  the orchestrator, code capture, Studio client, and manual endpoints
  (`/api/heal/:scraperId/*` — preview-prompt, status, trigger, approve,
  reject, recover). **Heals fire automatically** when a pull comes back broken,
  gated by `HEAL_AUTO_ENABLED` (default on) and capped per scraper per day.
- **The dashboard cannot spend anything** (Aug 23, PR #41). It had server
  actions carrying `OPS_TOKEN`, on a page with no login. They are gone: reads
  are public, writes need the token, and `apps/web` holds no secret at all.
- **The heal story has its own page**, `/healing` (PR #46): fleet, activity,
  incidents and every repair attempt with its prompt, diff, canary and cost.
  `/behind` is provenance and data quality only.
- **Studio failures are classified** (PR #42) into broken / timeout / empty /
  no-urls / unprovisioned. Only `broken` auto-heals, because only a broken
  extraction template is a thing a template rewrite can fix. The notifier
  module (email + telegram channels) exists with no callers. Migrations now
  run 0000-0005.
- **Ingest is the open seam.** `POST /api/ingest/:scraperId` checks the
  webhook secret and validates rows against the fleet output contract, then
  drops them — DB persistence is not wired.
- **Deploy runs the whole app.** `postgres`, `api` and `web`; the `app` profile
  that gated the last two is gone. `web`'s Coolify port is 3000, not 80, and
  the API applies pending migrations on boot.
- Bright Data: two separate accounts, two separate budgets, and they are no
  longer symmetric. Spencer's holds every Studio collector and has spent
  roughly half its credits — $0.52 on the 433-call vetting sweep and $26.54
  on abandoned listing-page Studio runs. Edjin's is nearly untouched at
  $52.00 with $0.02 of zone spend. Spend is metered per action by
  `studio.py`'s `Guard` on the Python side and `lab/scripts/bd.mjs` on the Node
  side — see [credit monitoring](credit-monitoring.md). Each guard only sees
  the account it is authenticated as, so each of us monitors our own.
- PH gate: **passed**. Nine PH sites vet cleanly against a requirement of
  two; the fleet is locked at 19 stores in
  `lab/spencer-exploration/fleet.lock.json`.
- Submissions: open from Aug 19, early filing encouraged for organizer
  feedback, and the form stays editable after you submit.

## Open items requiring alignment

Items that need both people to agree before work proceeds. Check off in the
PR that resolves each one; do not silently close them.

- [ ] **Which account owns the fleet?** Triggers and heals cannot cross
  accounts, so the deployed orchestrator's key fixes the fleet, the heal
  loop and the budget guard to one account; the other becomes a dev sandbox.
  Spencer's account holds every Studio collector but has spent roughly half
  its credits. Edjin's is nearly untouched but owns nothing. The demo needs
  whichever account runs the live heal to still be funded.
- [ ] **Weee! registry correction.** The browser pass measured 10/10 basket
  staples with prices in static HTML. The registry has it as `reject`, score
  15, `blocked via none` — a collector failure, not a site problem. Proposed
  edit: promote to `fleet_ready` or at minimum `bench`. Evidence in
  [site-vetting.md](site-vetting.md) and `lab/edjin-exploration/vet.json`.
- [ ] **S&R login-wall check.** The registry has `ph-snr` as `fleet_ready`
  on the PH bench. A manual browser look found prices behind a membership
  login. If that holds, it is out under the public-data-only house rule.
  Needs someone to confirm a price is visible while logged out before it can
  be promoted.
- [ ] **H-E-B demotion.** Currently `backup` in the registry. Bright Data
  itself refuses the site without KYC — it is unavailable to us at any
  price. Proposed: demote to `reject`.
- [ ] **Guard unification.** `bd.mjs` reads caps from `.env`; `studio.py`'s
  `Guard` and `bd_tier1.py`'s `Budget` take `cap_usd` as a plain argument
  with no env fallback (callers default it to 5.0). Changing a
  cap in `.env` only changes one side today. Proposed: Python guards fall
  back to the env vars when no explicit argument is given. Details in
  [credit-monitoring.md](credit-monitoring.md) under "Unified guard
  protocol".
- [ ] **Heal agent scope and its three questions.** The
  [proposal](plans/heal-agent-proposal.md) asks: Haiku or Sonnet for the pin
  validator; reuse `heal_attempts` or add a `quality_decisions` table; and
  whether a wholesale-only store like MexMax gets flagged pin by pin or demoted
  from `index_contributor` outright. Also open is how much of the four-strategy
  design to build this week — the URL slug check alone catches all three MexMax
  failures in ten lines and needs no LLM. Phases 1-2 of the
  [integration plan](plans/heal-integration-plan.md) are in `modules/heal/` as
  of Aug 22; the three questions above remain unanswered.
- [ ] **`priceRecordSchema` update.** The fleet output contract still
  requires `unit` (rejects 15% of the catalogue), has no size/unit-price
  fields, no `source`, and no `size_change` incident kind. All specified in
  [HANDOFF.md](../lab/spencer-exploration/HANDOFF.md) with a tested reference
  implementation. Touches `packages/contract` and every consumer of the
  schema in both apps together, per the coupling rule. Needs
  agreement on whether to land before or after scraper creation.
