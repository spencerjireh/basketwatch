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
- Review artifacts (shareable pages):
  - HLD: https://claude.ai/code/artifact/a6c6e40f-22be-4b1d-b8f7-2c3f08578463
  - PRD: https://claude.ai/code/artifact/f7cf34cf-af6e-4efd-8f76-16dd1865ef36

## Standing status

- **App rebuilt Aug 20.** `scrape-verse/` was replaced by `basketwatch/` on
  pnpm + Turborepo, NestJS + Next.js. Only the Drizzle schema and migration
  0000 were carried across, because they describe the live database. The clone
  store was deleted in the rebuild and is scheduled to be rebuilt **last**,
  after the read path, ingest and the heal loop — team decision Aug 20, which
  closes C7. It remains the required demo centrepiece.
- **Data is in prod.** 19 stores, 28,378 products, 28,376 price observations,
  340 basket pins, 21 items. Nothing writes to it on a schedule yet, and no
  endpoint reads it: every dashboard route returns 501 and the UI runs on
  fixtures.
- **Deploy is live but app-less.** Only `postgres` runs; `api` and `web` are
  profile-gated. When `web` is switched on, its Coolify port is 3000, not 80.
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
  `Guard` and `bd_tier1.py`'s `Budget` hardcode `cap_usd=5.0`. Changing a
  cap in `.env` only changes one side today. Proposed: Python guards fall
  back to the env vars when no explicit argument is given. Details in
  [credit-monitoring.md](credit-monitoring.md) under "Unified guard
  protocol".
- [ ] **`priceRecordSchema` update.** The fleet output contract still
  requires `unit` (rejects 15% of the catalogue), has no size/unit-price
  fields, no `source`, and no `size_change` incident kind. All specified in
  [HANDOFF.md](../lab/spencer-exploration/HANDOFF.md) with a tested reference
  implementation. Touches `packages/shared` and `mock.ts` together per the
  coupling rule. Needs agreement on whether to land before or after scraper
  creation.
