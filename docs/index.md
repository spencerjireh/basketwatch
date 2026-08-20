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
4. [API contract](api-contract.md) — frozen v1 endpoint and response shapes;
   the seam the data plane and control plane meet at.
5. [Deploy runbook](deploy.md) — the Coolify resource, the domains, and how to
   connect to the deployed Postgres.

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
- Code: `../scrape-verse/` (see its [README](../scrape-verse/README.md)).
- Review artifacts (shareable pages):
  - HLD: https://claude.ai/code/artifact/a6c6e40f-22be-4b1d-b8f7-2c3f08578463
  - PRD: https://claude.ai/code/artifact/f7cf34cf-af6e-4efd-8f76-16dd1865ef36

## Standing status

- Bright Data: two separate accounts, two separate budgets. Spencer's is
  verified (cleared Aug 17) and holds the Aug 15-17 experiment collectors,
  balance ~$49.76 as of Aug 18. Edjin's is a second account, balance $52.00
  as of Aug 18, verification status untested.
- OPEN DECISION: which account owns the fleet. Triggers and heals cannot
  cross accounts, so the deployed orchestrator's key fixes the fleet,
  the heal loop and the budget guard to one account; the other becomes a
  dev sandbox.
- PH gate: 2+ PH sites must vet cleanly by Aug 19 EOD.
- Submissions: open from Aug 19, early filing encouraged for organizer
  feedback, and the form stays editable after you submit.
