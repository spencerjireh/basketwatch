# Self-Healing Pipeline Audit

> Aug 22, 2026 -- Full code-level review of the provision-to-heal pipeline.
> Covers every stage: provisioning, pull/collection, validation, healing,
> job queue, and the database schema backing them.

## Executive Summary

The end-to-end wiring is complete and fires in production. Every link in the
chain -- provision from dashboard, collector creation in BD, pull trigger,
failure detection, incident with evidence, heal enqueue -- has been exercised.
However, the pipeline has **14 actionable gaps** across six areas. The three
most impactful are:

1. **No distinction between "slow" and "broken"** -- timeouts, empty data, and
   real extraction failures all collapse into the same `StudioError` and
   trigger identical heal attempts, wasting credits on scrapers that aren't
   broken.
2. **Dry run is not dry** -- on the failure path, a dry run writes real runs,
   real incidents, and enqueues real heals.
3. **Incident pile-up on Studio failures** -- the Studio-failure path in
   `pullers.service.ts` never checks for an existing open incident before
   creating a new one, unlike the validator path which does.

---

## Findings by Pipeline Stage

### 1. Provisioning

**Files:** `provision.service.ts`, `fleet.controller.ts`, `fleet.repository.ts`

#### P-1: Double-provision race (credits)

`provisionStore` reads `getCollectorId`, and if absent, calls `createCollector`
then writes back. There is no DB lock between the read and write. Two concurrent
calls (double-click, or `provisionAll` racing a per-store call) can both pass
the "already exists" check, both call `brightdata scraper create` (spending
double credits), and race to `setCollectorId` -- last write wins, orphaning a
live BD collector the DB no longer references.

**Severity:** Medium (credit waste + orphaned collector)
**File:** `apps/api/src/modules/fleet/provision.service.ts:70-96`

#### P-2: No readiness check after provision

`provisionStore` returns success as soon as the CLI returns a `collector_id`.
There is no verification that the newly created collector is queryable on BD's
side. Nothing stops a pull from firing immediately against a collector that
hasn't finished its initial index run. This is the exact issue we observed with
`us-amigofoods`.

**Severity:** High (premature pull -> false failure -> wasted heal credit)
**File:** `apps/api/src/modules/fleet/provision.service.ts:82-89`

#### P-3: `maxUrls` declared but never enforced

`ManifestEntry` declares `maxUrls`, but `createCollector`'s CLI args never pass
it. Crawl-scope bounding relies entirely on the free-text `description` -- the
same approach that once caused a 150-page crawl incident.

**Severity:** Low (mitigated by description wording, but fragile)
**File:** `apps/api/src/modules/fleet/provision.service.ts:119-129`

#### P-4: Never-run stores appear "healthy"

`fleet.repository.ts` `stateFor()` treats "no run + no incident" as `healthy`.
A store that has never successfully pulled looks identical to a healthy one on
the dashboard.

**Severity:** Medium (misleading UI)
**File:** `apps/api/src/modules/fleet/fleet.repository.ts:137-153`

---

### 2. Pull / Collection

**Files:** `studio.adapter.ts`, `pullers.service.ts`, `pullers.controller.ts`,
`pullers.repository.ts`

#### C-1: Fixed timeout for all stores (12 min)

`HARD_DEADLINE_MS` is a single fixed 12-minute deadline regardless of store
size. Stores with 300-400 page ceilings and browser rendering (`ph-landers`,
`us-hmart`, `us-kesargrocery`, `us-dierbergs`) are plausible candidates to
exceed it. A timeout is indistinguishable from a real failure.

**Severity:** High (false failure -> unnecessary heal on large stores)
**File:** `apps/api/src/modules/pullers/adapters/studio.adapter.ts:28-29`

#### C-2: Timeout vs. empty vs. broken are indistinguishable

Both CLI timeout and zero usable rows funnel into the same `StudioError` and
the same `handleStudioFailure` path: record error run, open incident, enqueue
heal. The system cannot distinguish "ran out of time" from "selectors broke"
from "genuinely zero listings."

**Severity:** High (heal credits spent on non-broken scrapers)
**Files:** `studio.adapter.ts:59-69,162-168`, `pullers.service.ts:198-252`

#### C-3: Sitemap failure is structurally unhealable

`discoverProductUrls` fetches sitemaps via plain HTTP, not Studio. If every
fetch fails, `seedUrls()` returns `[]`, and `pull()` throws "no URLs to
submit" -- routing into the standard heal path. But a BD `refactor_template`
heal can only rewrite the Studio extraction template, not this codebase's
sitemap-fetching logic. This class of failure is structurally unhealable by
the auto-heal loop, yet diagnosed identically to an extraction bug.

**Severity:** Medium (wasted heal attempt, confusing incident evidence)
**File:** `apps/api/src/modules/pullers/adapters/studio.adapter.ts:98-129`

#### C-4: Dry run is not dry on the failure path

`runStore()` calls `this.collect(config)` unconditionally -- a dry run still
invokes the real, credit-spending Studio collection. If that collection throws
a `StudioError`, control goes to `handleStudioFailure` **before** the
`options.dryRun` check. Inside `handleStudioFailure`, `options.dryRun` is
never read. A dry-run pull against a broken collector will unconditionally:

1. `recordEmptyRun` -- writes a real `runs` row
2. `openIncident` -- writes a real incident
3. `boss.send(QUEUES.heal)` -- enqueues a real heal job

This violates the documented contract in `puller.types.ts`.

**Severity:** High (credits spent, state polluted on what should be safe)
**File:** `apps/api/src/modules/pullers/pullers.service.ts:91-97,211-244`

#### C-5: Incident pile-up on Studio failures

`handleStudioFailure` calls `openIncident()` unconditionally on every Studio
failure, with no `hasOpenIncident` check. Compare to `ValidatorService` which
explicitly checks first. Every repeated failure for the same store creates a
new incident row. There is no DB-level uniqueness constraint to backstop this.

**Severity:** Medium (cluttered incident history, confusing heal targeting)
**File:** `apps/api/src/modules/pullers/pullers.service.ts:230-232`

#### C-6: Manual pull + cron pull can race

Manual pulls via `POST /pullers/:storeId/run` run in-process, guarded by an
in-memory `Map` (`activePulls`). Cron pulls use pg-boss with `singletonKey`.
These are two independent concurrency mechanisms that don't communicate. A
manual and cron trigger for the same store can run concurrently, double-spending
Studio credits and producing overlapping `runs` rows.

**Severity:** Low (unlikely with schedule disabled, but a latent bug)
**File:** `apps/api/src/modules/pullers/pullers.service.ts:24,39-72`

#### C-7: Validation depends on client polling (manual path)

`runStore()` returns a `runId` but does not enqueue `validateRun`. That only
happens in `pullStatus()` when the dashboard client polls after completion. If
the client disconnects (tab closed, page refresh) right when the pull finishes,
`validateRun` is never enqueued. Anomalies that only the validator catches
(null-rate spikes, drift) go undetected.

**Severity:** High (silent validation gap)
**File:** `apps/api/src/modules/pullers/pullers.controller.ts:42-49`

---

### 3. Validation

**Files:** `validator.service.ts`, `validator.repository.ts`, `checks.ts`

#### V-1: Boot-time baseline reseed launders degraded data

`onApplicationBootstrap()` calls `seedAllBaselines()` on every API start (every
Coolify redeploy). This recomputes and **overwrites** the baseline for every
store from current `products` data, with zero check on whether that data
reflects a healthy run. A restart at the wrong moment permanently raises the bar
for what counts as anomalous, masking drift.

**Severity:** High (permanent masking of data quality degradation)
**File:** `apps/api/src/modules/validator/validator.service.ts:39-42`

#### V-2: Empty product set returns "ok"

If `products.length === 0`, `validateStoredRun` logs a warning and returns
`{status: "ok", findings: []}` without opening an incident. A store whose
`products` table is empty for any reason reports "no news" rather than a hard
failure.

**Severity:** Medium (missed alert on data loss)
**File:** `apps/api/src/modules/validator/validator.service.ts:47-51`

#### V-3: No minimum sample size for baselines

`computeAndSeedBaseline` has no minimum sample-size guard. A store with 3
products computes p5/p95 price ranges from 3 data points, which is
statistically meaningless but treated identically to a 500-product baseline by
`checkDrift`.

**Severity:** Low (edge case, but could cause false drift positives)
**File:** `apps/api/src/modules/validator/validator.repository.ts:147-198`

---

### 4. Healing

**Files:** `heal.orchestrator.ts`, `heal-auto.handler.ts`, `prompt.ts`,
`heal.controller.ts`, `heal.budget.ts`, `studio.client.ts`

#### H-1: `maxAttemptsPerIncident` is display-only, never enforced

`HealBudget.maxAttemptsPerIncident` (default 3) is served via `/api/budget` for
display but never checked in `trigger()`. `checkBudget()` only checks
`todaysHealCount >= maxHealsPerScraperPerDay`. A single incident can accumulate
unlimited attempts over multiple days (5/day indefinitely).

**Severity:** Medium (unbounded credit spend on a persistent failure)
**File:** `apps/api/src/modules/heal/heal.orchestrator.ts:364-372`

#### H-2: Manual heal trigger bypasses pg-boss dedup

`HealController.trigger()` calls `orchestrator.trigger()` directly, bypassing
pg-boss. A dashboard "trigger heal" click and an auto-heal job for the same
scraper can execute concurrently. Both pass `checkBudget()` (no lock, TOCTOU),
both call BD's `refactor_template` concurrently. The loser's `heal_attempts`
row is orphaned.

**Severity:** Medium (wasted heal credit, orphaned attempt)
**File:** `apps/api/src/modules/heal/heal.controller.ts:52-58`

#### H-3: `incidentId` from job payload is ignored

`HealAutoHandler` receives `{ scraperId, storeId, incidentId }` but only uses
`scraperId` and `storeId`. The orchestrator re-fetches "the latest open
incident" by `ORDER BY opened_at DESC LIMIT 1`. If a newer incident opened
between enqueue and processing (plausible with C-5 pile-up), the heal targets
the wrong incident.

**Severity:** Low (confusing audit trail, but heal still fires)
**File:** `apps/api/src/modules/heal/heal-auto.handler.ts:27-29`

#### H-4: Credit spend is never recorded

`heal_attempts.creditsSpent` and `runs.creditsUsd` are real columns that no
code path populates. `finishAttempt` always receives `null` for credits.
After-the-fact cost accounting is not implemented for the production path.

**Severity:** Medium (no spend visibility for the team)
**File:** `apps/api/src/modules/heal/heal.orchestrator.ts:190,255,298`

#### H-5: Production path bypasses the guarded wrapper

The `AGENTS.md` hard rule requires all BD-spending calls to go through
`lab/scripts/bd.mjs` or `studio.py`'s `Guard`. The production API path does
not use either. `StudioClient` calls BD's HTTP API via `fetch`;
`ProvisionService` and `StudioAdapter` call the CLI via `execFile`.
`CREDIT_DAILY_CEILING_USD` is display-only.

**Severity:** High (no pre-flight balance check in production)
**File:** Multiple -- `studio.client.ts`, `provision.service.ts`,
`studio.adapter.ts`

---

## Prioritized Fix Plan

### Must-fix before demo (critical path)

| ID | Fix | Why |
|----|-----|-----|
| C-2 | Classify `StudioError` into subtypes: `timeout`, `empty`, `broken`. Only auto-heal on `broken`. | Prevents wasted heal credits on slow-but-healthy collectors |
| C-7 | Enqueue `validateRun` inside `runStore()` after `recordRun`, not in the polling endpoint | Validation should not depend on client behavior |
| C-4 | Guard `handleStudioFailure` with `if (options.dryRun) return` early | Dry run must be safe |
| C-5 | Add `hasOpenIncident` check before `openIncident` in `handleStudioFailure` | Matches the validator path; prevents pile-up |
| P-2 | Add a grace period after provisioning (e.g., disable pull button for 5 min, or check collector status via BD API before first pull) | Prevents the premature-heal false positive we saw live |
| V-1 | Gate `seedAllBaselines` behind a flag or remove boot-time reseed entirely; only seed after validated-healthy runs | Prevents baseline laundering on redeploy |

### Should-fix (robustness)

| ID | Fix | Why |
|----|-----|-----|
| C-1 | Scale `HARD_DEADLINE_MS` by `config.maxPages` or `manifest.maxUrls` | Large stores need more time |
| P-1 | Use `INSERT ... ON CONFLICT DO NOTHING` or a DB advisory lock in `provisionStore` | Prevents double-provision |
| H-1 | Enforce `maxAttemptsPerIncident` in `checkBudget()` | Bounds per-incident spend |
| H-2 | Route manual heal triggers through pg-boss too, or add an advisory lock | Prevents concurrent heals |
| P-4 | Distinguish "never run" from "healthy" in `stateFor()` | Dashboard accuracy |
| V-2 | Treat empty product set as `broken`, not `ok` | Catch data-loss scenarios |

### Nice-to-have (cleanup)

| ID | Fix | Why |
|----|-----|-----|
| H-3 | Pass and use `incidentId` through the heal chain | Correct audit trail |
| H-4 | Record `creditsSpent` from BD API response | Spend visibility |
| V-3 | Require minimum sample size (e.g., 10) for baseline seeding | Statistical validity |
| C-3 | Surface sitemap failures as a distinct incident kind (`sitemap_error`) that skips heal | Don't waste heals on infra failures |
| C-6 | Unify manual and cron pull concurrency via pg-boss | Eliminate race |
| P-3 | Pass `maxUrls` to the CLI if BD supports it | Structural crawl bound |

---

## How to Read This Report

Each finding has:
- **ID** -- stage letter + number (P = provision, C = collection, V = validation, H = heal)
- **Severity** -- High / Medium / Low based on credit impact, data correctness, and demo risk
- **File reference** -- exact file path and line range in the current codebase

The fix plan is ordered by demo impact. The "must-fix" set directly affects
whether the demo can show a clean provision -> pull -> validate -> heal cycle
without false positives or wasted credits.
