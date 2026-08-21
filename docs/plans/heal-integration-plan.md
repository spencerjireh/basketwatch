---
title: Heal pipeline integration plan
tags: [hackathon, brightdata, heal, plan]
created: 2026-08-21
status: approved, ready to build
---

# Heal pipeline integration plan

Updated Aug 21 after Phase 1 integration testing. The plan shifts
focus from prompt quality to **pipeline integration** -- connecting the
existing pieces into an end-to-end self-healing loop visible on the
dashboard's `/behind` page.

Test findings driving this plan are in
[lab/edjin-exploration/heal-test-findings.md](../../lab/edjin-exploration/heal-test-findings.md).
Prompt construction rules are in
[docs/heal-prompt-guidelines.md](../heal-prompt-guidelines.md).

## Current state

Phase 1 is built and merged (PR #20). What exists:

- `POST /api/heal/:scraperId/trigger` -- triggers BD heal, polls, returns preview
- `POST /api/heal/:scraperId/approve` and `/reject` -- approve/reject the diff
- `prompt.ts` -- numbered-list prompt generator (pure function)
- `studio.client.ts` -- BD Scraper Studio API wrapper
- `heal.repository.ts` -- incident and attempt tracking
- `heal.budget.ts` -- per-scraper daily heal limits

What does NOT exist (the integration gaps):

1. Nothing runs spider-sense automatically after a pull
2. Nothing creates incidents from validation findings
3. Nothing triggers a heal from an incident automatically
4. Nothing re-runs the scraper after an approved heal to verify the fix
5. No LLM triage to decide "should we heal at all?"
6. `nullRatePct` is hardcoded to 0 on the fleet board
7. No heal button on the dashboard

## Prompt strategy: dual-path with fallback

The Phase 1 integration test showed that LLM-style prompts produce
better code than the numbered-list generator, and that triage (deciding
whether to heal at all) is the biggest gap. The architecture supports
both paths, toggled by configuration:

```
HEAL_USE_LLM_TRIAGE=true   # default false
ANTHROPIC_API_KEY=sk-...    # required when triage is enabled
```

| Condition | Prompt path |
|---|---|
| `HEAL_USE_LLM_TRIAGE=true` + API key present | LLM triage: examines sample products, decides skip/heal, composes targeted prompt |
| `HEAL_USE_LLM_TRIAGE=false` or no API key | Programmatic fallback: numbered-list from validator output |
| LLM call fails (rate limit, timeout, error) | Automatic fallback to programmatic path |

The programmatic path is always available. The LLM path is an
enhancement that adds triage intelligence and prompt quality.

## Phase 2 -- Wire the pipeline (priority: hackathon demo)

**Goal**: after a pull completes, the system automatically detects
issues and surfaces them on the dashboard. The operator reviews health
status and triggers heals from the UI.

### 2a. Post-pull validation

Wire the spider-sense validator to run automatically after each
puller run completes. The `validate-run` pg-boss job already has a
named queue -- implement the handler.

```
puller completes run
  -> pg-boss enqueues validate-run job
  -> validator runs checks against the run's data
  -> findings stored on the run record
  -> if any hard failures: create/update incident
```

Files: `modules/validator/validate-run.handler.ts` (new),
update `modules/pullers/` to enqueue after run.

Prerequisite: seed `baselines` table. Either a one-time backfill from
existing run history, or a rolling computation after each `ok` run.
The table FK is currently on `scraperId` but most pullable stores have
no scraper -- likely needs re-keying to `storeId`.

### 2b. Real health metrics on fleet board

Once validation runs and stores findings:

- Replace `nullRatePct: 0` hardcoded in `fleet.repository.ts` with
  the real computed value from the latest run's findings.
- Status dots reflect actual validation verdicts (broken/suspect/ok).
- `healsToday` already works from `heal_attempts`.

Files: update `fleet.repository.ts` lateral join, may need a
`findings jsonb` or `null_rate_pct numeric` column on `runs`.

### 2c. Dashboard heal section on `/behind`

Add per-scraper heal controls to the existing fleet board:

- "Heal" action button per scraper row (only when broken/suspect),
  next to the existing "open audit" button.
- Heal dialog modal: shows the auto-generated prompt (editable),
  triggers heal on confirm, then shows the diff for approve/reject.
- Heal-in-progress state: status dot shows "healing", button disabled.

Files: update `fleet-board.tsx`, new `HealDialog` component, new
API route handler in dashboard for proxying heal trigger/approve/reject.

### 2d. LLM triage layer (when configured)

Before composing the prompt, the orchestrator calls a triage function
that queries sample products for the scraper's store and asks:

1. Are the null fields legitimately null? (deli items, non-grocery)
2. What specific patterns should the heal target?
3. Should we skip this heal entirely?

If the triage says skip, the incident is marked `wont_fix` with the
LLM's reasoning, and no credits are spent.

```typescript
interface TriageDecision {
  action: 'heal' | 'skip'
  reason: string
  prompt?: string  // targeted prompt when action is 'heal'
}
```

Files: `modules/heal/triage.ts` (new), update `heal.orchestrator.ts`
to call triage before trigger.

### 2e. Post-heal verification

After a heal is approved, automatically re-run the scraper on a
single product page (canary run) and re-validate. If the canary
passes, resolve the incident. If it fails, log the result and
leave the incident open.

```
heal approved
  -> enqueue scrape-run job (single URL, canary: true)
  -> on completion, enqueue validate-run
  -> if passes: resolve incident
  -> if fails: log, leave incident open for retry or escalation
```

Files: update `heal.orchestrator.ts` approve path to enqueue canary.

**Deliverable**: the full self-healing loop is demoable. Break a
scraper -> system detects -> surfaces on dashboard -> operator triggers
heal -> reviews diff -> approves -> system verifies -> resolves.

## Phase 3 -- Template capture and retry escalation

Add template tracking and retry logic:

1. On every heal (trigger or approve), capture `diff.template_a`
   and `diff.template_b`. Store current template on `scrapers`.
2. Prompt generator includes selector hints from stored template.
3. If attempt 1 times out, retry with a different prompt style
   (problem description without selectors). After 2 failures,
   escalate the incident.

**Deliverable**: selector-enriched prompts ($0.24 fixes from
experiments), retry resilience, template version history.

## Phase 4 -- Auto-approve for high-confidence fixes (post-hackathon)

Add a confidence scorer that checks preview results against expected
ranges. High-confidence fixes auto-approve. Low-confidence holds for
review. This is the transition from "operator in the loop" to
"operator on exception."

## What we deliberately skip

- **Automatic heal triggering**: heals are triggered by the operator
  from the dashboard, not automatically from incidents. The system
  detects and surfaces; the human decides and triggers.
- **Scheduled heal runs**: heals are triggered by incidents from
  validation, not by cron.
- **`custom_input` parameter**: undocumented, untested.
- **Quality gate (Strategies 2-4 from [heal-agent-proposal](heal-agent-proposal.md))**: mapping
  heal, price heal, and output heal are post-hackathon. The proposal
  documents them; the implementation plan does not include them.

## Integration points (from codebase exploration)

Key files and their role in the pipeline:

| File | Role | Change needed |
|---|---|---|
| `pullers.service.ts` ~line 101 | After `recordRun` | Add `boss.send(QUEUES.validateRun, { runId, storeId })` |
| `validator/checks.ts` | Pure validation functions | Already works, no change |
| `validator/validator.service.ts` | Stub `validateStoredRun` | Implement: load baseline + run, call checks, write findings |
| `jobs/queues.ts` | Queue names | Already has `validateRun`, `heal`, `notify` reserved |
| `jobs/handlers/` | Only `fleet-pull.handler.ts` exists | Add `validate-run.handler.ts` |
| `heal/heal.orchestrator.ts` | Manual trigger/approve/reject | Wire triage layer, canary on approve |
| `fleet/fleet.repository.ts` line 84 | `nullRatePct: 0` hardcoded | Join against real findings |
| `database/schema.ts` `baselines` table | Exists, nothing touches it | Need a repository + seed logic |
| `database/schema.ts` `runs` table | No findings column | Add `findings jsonb` or `null_rate_pct numeric` |
| `fleet-board.tsx` | Shows fleet status | Add heal button, heal dialog |
| `packages/contract` | Schemas for fleet, incidents, heal | May need `HealTriggerBody` on fleet response |
