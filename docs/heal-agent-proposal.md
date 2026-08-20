---
title: Proposal — unified heal agent with data quality gate
tags: [hackathon, architecture, proposal]
created: 2026-08-20
status: draft, pending team review
---

# Unified heal agent: scraper repair + data quality gate

## Problem statement

The current architecture separates healing from quality:

- **Spider-Sense** detects structural anomalies — null spikes, schema
  violations, row count collapse, value drift.
- **Heal Orchestrator** repairs broken scrapers via Bright Data Studio heal.
- **Basket mapping** (`basket.py`) is a one-shot process with no validation
  after the initial pick.

This separation creates a blind spot. Spider-Sense catches a scraper that
returns nothing; it does not catch a scraper that returns the wrong thing.
The mapper catches a product named "Sugar Kids Girls' Sandals" (no parseable
size, rejected); it does not catch "Easter Egg Ovo Lacta Laka Branco 175grs"
(has a parseable size, accepted as eggs, is chocolate).

Evidence from the Aug 20 database audit:

| Basket pin | Store | What's in the DB | What it actually is |
|---|---|---|---|
| eggs | Amigo Foods | Easter Egg Ovo Lacta Laka Branco 175grs, $9.99 | Chocolate Easter egg |
| eggs | MexMax | Huevitos de Paloma Flavored Eggs with Candy Shell, $130.24 | Candy |
| milk | SM Markets | Ichitan Brown Sugar Milk 310ml, P45 | Flavored bubble tea |
| sugar | LiliMart | Soy Bean Curd Taho Mix w/ Brown Sugar, $13.99 | Taho dessert mix |
| milk | MerryMart | Alaska Evaporada 360ml, P2,786 | Case of 48 cans, not 1 |
| rice | MexMax | Goya Thai Jasmine Rice 5lb, $125.03 | Case of ~10, not 1 |
| sugar | MexMax | C&H Sugar Granulated 4lb, $88.43 | Case of 10, not 1 |
| eggs | Sukli | Cooked Salt Duck Egg 6pcs, $6.95 | Preserved duck egg, not fresh |

All eight passed the existing five-gate matcher (`name_is_the_staple`,
`size_required`, `unit_family_ok`, `size_is_plausible`,
`pick_from_catalogue` with category ranking). All eight have correct prices —
verified against live Shopify JSON, 14/14 exact match. The data pipeline is
accurate; the mapping layer is not selective enough.

A judge looking at the basket comparison will see Easter eggs at $9.99 next
to real eggs at $8.99. That is the product lying, not breaking.

## Proposal: one agent, three kinds of healing

Instead of adding more keyword lists to the mapper (which will always have
gaps), build a unified **Heal Agent** that manages the entire quality
lifecycle. The Bright Data heal mechanism handles scraper-level fixes. An
LLM handles semantic-level decisions. Both feed the same audit trail.

### Architecture

```
ingest
  |
  v
spider-sense (structural checks, pure functions, no IO)
  |                    |
  | clean              | broken
  v                    v
store in DB        heal agent --> scraper heal strategy
  |                              (Studio heal, existing design)
  v
quality gate (semantic checks, runs on basket mapping)
  |                    |
  | clean              | anomaly
  v                    v
accept             heal agent --> mapping / price / output strategy
```

Spider-Sense stays pure and IO-free (per AGENTS.md). The quality gate is a
separate layer that runs after data lands, during basket mapping or on a
scheduled audit. The heal agent owns the triage decision and dispatches to
the right strategy.

### Strategy 1: scraper heal (existing, via Bright Data Studio)

**When**: Spider-Sense detects schema violation, null spike, empty output,
row count collapse.

**How**: The existing loop from `architecture.md` — evidence bundle to
Claude, Claude generates a heal prompt, `scraper heal <id> "<prompt>"`,
canary run, re-validate. Already designed, not yet built.

**What's new**: The heal agent triages before dispatching. A null spike in
`price` is a scraper break (Strategy 1). A null spike in `size_value` on a
scraper whose prices are fine might be a prompt issue (Strategy 4).

### Strategy 2: mapping heal (new, LLM-assisted)

**When**: Quality gate flags a basket pin as suspicious, or basket mapping
runs for a new/updated store.

**How**: For each basket pin, one Claude API call:

```
System: You are a grocery data quality validator for a price comparison
index. Your job is to determine whether a product is a genuine single
retail unit of a basket staple.

User: The basket needs "{item_label}" for a {country} grocery price index.
The target format is {target_size}.

The mapper picked:
- Product: "{product_name}"
- Price: {price} {currency}
- Store: {store_name}
- URL: {product_url}

Questions:
1. Is this product a genuine retail unit of the staple? (yes/no)
2. If no, what is it actually? (one line)
3. If no, what search terms would find the real staple in this store?
```

If the LLM says no:

1. Mark the pin as `rejected` with the LLM's reason in `basket_map.note`.
2. Search the store's existing product catalogue for a better match using
   the LLM's suggested terms.
3. Re-validate the new pick with the same LLM check.
4. If no valid pick exists, mark as `not_stocked` rather than leaving a
   wrong product pinned.
5. Log the full exchange (old pick, reason, new pick) in `heal_attempts`.

**Cost**: ~340 pins at roughly 200 tokens input + 80 tokens output each.
At Claude Sonnet pricing that is well under $0.10 total and takes about
two minutes sequentially, faster if batched. This runs once per basket
rebuild, not on every scrape.

**What it catches**: Every false positive in the table above. The LLM
knows that "Easter Egg Ovo Lacta Laka Branco" is chocolate, that "Huevitos
de Paloma Flavored Eggs with Candy Shell" is candy, and that "Soy Bean
Curd Taho Mix w/ Brown Sugar" is not sugar. No keyword list required.

### Strategy 3: price heal (new, statistical + URL heuristic)

**When**: Quality gate runs a cross-store comparison after basket mapping
completes.

**How**: Two checks, applied in order:

**Check A — URL slug detection.** If the product URL contains any of
`case-`, `bulk-`, `wholesale-`, `box-of-`, `crate-`, `pallet-`, flag the
pin as `suspect_wholesale`. This is a five-line regex and it would have
caught all three MexMax failures — their URLs literally say
`case-10-units`, `case-18-units`.

```ts
const WHOLESALE_SLUGS = /\b(case|bulk|wholesale|box-of|crate|pallet)\b/i

function isSuspectWholesale(url: string): boolean {
  return WHOLESALE_SLUGS.test(new URL(url).pathname)
}
```

**Check B — cross-store outlier.** Per item per country, compute the
median unit price across all stores with `status: verified` pins. Flag any
pin whose unit price exceeds 3x the median. This requires at least 4 clean
pins to anchor the median — below that threshold, skip the check rather
than anchoring on bad data.

```ts
function flagOutliers(
  pins: { storeId: string; unitPrice: number }[],
  threshold = 3,
): string[] {
  if (pins.length < 4) return []
  const sorted = pins.map(p => p.unitPrice).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return pins
    .filter(p => p.unitPrice > median * threshold)
    .map(p => p.storeId)
}
```

**What it catches**: Case/wholesale pricing (MerryMart milk at P7,739/L,
MexMax rice at $55/kg). These are real prices for the wrong purchase unit.
The URL check catches them before the outlier gate even runs when the slug
is present; the outlier gate catches them when it is not.

**Limitation** (identified during review): The outlier gate needs enough
clean pins to compute a reliable median. It works well for PH (5-6 clean
stores) but may be shaky for US items where several stores are ethnic
specialty retailers with legitimately different price ranges. For this
reason it runs after Strategies 1 and 2 have cleaned the obvious false
matches, not before.

### Strategy 4: output heal (new, targeted Studio heal)

**When**: A scraper consistently returns bad size data — "1G" instead of
"1Gal.", empty size fields when the product title clearly states one, or
sizes that disagree with the title.

**How**: Same Bright Data Studio heal mechanism as Strategy 1, but the
prompt targets size extraction specifically:

```
The size field returns "1G" for a product titled "1Gal. Vegetable Oil".
Extract the full size as printed on the page, including the unit. It
should be "1 Gal." or "1 Gallon". Do not abbreviate or truncate.
```

This is not a broken scraper (it returns data) and not a wrong product
(it is the right product). It is a scraper that works but misunderstands
one field. The heal prompt is narrower and more reliable than a full
scraper rebuild.

**Evidence that this matters**: Spencer's handoff documents a collector
that returned `"1G"` for `"1Gal."`, pricing cooking oil at PHP 799,950
per kilo. The rule in the handoff — emit no unit price rather than a wrong
one — is a defensive fallback. Strategy 4 fixes the source.

## Triage logic

The heal agent decides which strategy to use based on what failed:

```ts
function triage(incident: Incident): HealStrategy {
  // Structural break: the scraper itself is not working
  if (["schema", "nulls", "rowcount", "error"].includes(incident.kind)
      && incident.evidence.failedChecks.some(c => c.severity === "hard")) {
    return "scraper_heal"
  }

  // Size field specifically broken: targeted heal, not full rebuild
  if (incident.kind === "nulls"
      && incident.evidence.failedChecks.every(c =>
        c.detail.startsWith("size_"))) {
    return "output_heal"
  }

  // Wrong product pinned: LLM re-pick
  if (incident.kind === "basket_mismatch") {
    return "mapping_heal"
  }

  // Price anomaly: statistical + URL check
  if (incident.kind === "price_outlier") {
    return "price_heal"
  }

  // Default: scraper heal (the existing path)
  return "scraper_heal"
}
```

## New incident kinds

Two additions to `incidentKinds` in `packages/contract/src/vocabulary.ts`:

```ts
/** Quality gate: LLM determined the basket pin is not the staple */
"basket_mismatch",
/** Quality gate: unit price is a statistical outlier (>3x country median) */
"price_outlier",
```

These sit alongside the existing structural kinds (`schema`, `nulls`,
`rowcount`, `drift`, `freshness`, `error`, `studio_failed`,
`mass_change_suppressed`). They are opened by the quality gate, not by
spider-sense, and they dispatch to Strategies 2 and 3 rather than
Strategy 1.

The contract already defines `healAttemptSchema` (in `incidents.ts`)
with `claudeDiagnosis`, `healPrompt`, `studioDiff`, `canary`, `verdict`,
and `creditsSpent`. The quality gate writes to the same shape: mapping
heals populate `claudeDiagnosis` with the LLM's reasoning and leave
`studioDiff` null; scraper heals populate both. This keeps the audit
timeline unified with zero contract changes beyond the two new
`incidentKinds`.

## Where this lives in the codebase

As of PR #9-#11, the product tree is `basketwatch/` (pnpm + Turborepo),
not `scrape-verse/`. The shared types package is `packages/contract`,
not `packages/shared`. The validator moved to `modules/validator/`. A
heal module already exists at `modules/heal/` with stub files for the
orchestrator, budget guard and Studio client.

```
basketwatch/apps/api/src/modules/
  validator/
    checks.ts          # unchanged — structural checks, pure, IO-free
    checks.test.ts     # unchanged (14 tests)
    checks.types.ts    # CheckResult, Baseline types
    validator.module.ts
    validator.service.ts
  quality/             # NEW — semantic checks, runs during basket mapping
    title-check.ts     # non-food title keyword scan (pure function)
    url-check.ts       # URL slug wholesale detection (pure function)
    outlier-check.ts   # cross-store unit price outlier (pure function)
    llm-validator.ts   # Claude API call for basket pin validation
    gate.ts            # orchestrates all four, returns findings
    gate.test.ts       # unit tests with the eight known false positives
    quality.module.ts
  heal/                # EXISTS — extend with strategies
    heal.budget.ts     # already scaffolded
    heal.module.ts     # already scaffolded
    heal.orchestrator.ts  # stub — becomes the triage dispatcher
    studio.client.ts      # stub — Studio API wrapper
    strategies/           # NEW
      scraper-heal.ts  # Studio heal loop (existing design from arch doc)
      mapping-heal.ts  # LLM re-pick from catalogue
      price-heal.ts    # outlier flag + re-pick
      output-heal.ts   # targeted Studio heal for size fields
basketwatch/packages/contract/src/
  vocabulary.ts        # add basket_mismatch, price_outlier to incidentKinds
  incidents.ts         # add quality-gate check names
```

The `quality/` functions (`title-check`, `url-check`, `outlier-check`) are
pure — no IO, no database, no API calls. They take product data in and
return findings. `llm-validator` is the one module that calls the Claude
API; it is separate so the pure checks can be tested without mocking.

The heal module stubs (`heal.orchestrator.ts`, `studio.client.ts`,
`heal.budget.ts`) already exist from PR #9 and will be extended rather
than replaced.

## Audit trail

Every quality gate decision produces a row in `heal_attempts`:

```sql
INSERT INTO heal_attempts (
  id, incident_id, claude_diagnosis, heal_prompt,
  studio_diff, verdict, credits_spent
) VALUES (
  gen_random_uuid(),
  :incident_id,
  'LLM determined "Easter Egg Ovo Lacta Laka Branco 175grs" is a
   chocolate Easter egg, not a retail unit of eggs.',
  NULL,              -- no Studio heal for mapping issues
  NULL,              -- no scraper diff for mapping issues
  'rejected',        -- the pin was rejected
  0                  -- no Bright Data credits spent
);
```

The dashboard's heal audit view shows these alongside scraper heal
decisions. A judge looking at the incident timeline sees:

> **Incident #42 — basket_mismatch on us-amigofoods / eggs**
> Quality gate: product "Easter Egg Ovo Lacta Laka Branco 175grs" is
> chocolate, not eggs. Pin rejected. Re-picked: "Eggland's Best Large
> White Eggs 12ct" at $4.99. Verified by LLM. 0 credits spent.

This is the same audit vocabulary as a scraper heal, so the dashboard
code does not need a separate view — it is one timeline, multiple kinds
of healing.

## Demo narrative

Three acts, one agent, one audit trail:

**Act 1 — the scraper breaks.** A target store's page layout changes
(CSS class rename, price moves into a nested span). Spider-Sense catches
the null spike. Heal agent triages as `scraper_heal`. Studio heal runs,
canary verifies, incident closes. Dashboard shows the diff and the
prompt. (The clone store was removed in PR #11; the demo target is a
real scraper from the fleet, or whichever chaos surface the team selects
from the PRD's three costed options.)

**Act 2 — the data lies.** Show the basket comparison: Easter eggs at
$9.99 next to real eggs at $8.99. Quality gate catches it: the LLM says
"this is a chocolate Easter egg, not a retail unit of eggs." Heal agent
re-picks from the catalogue. Dashboard shows old pick, LLM reasoning, new
pick.

**Act 3 — the price makes no sense.** Show MexMax rice at $125.03 for 5lb
($55/kg) while every other US store is $2-10/kg. The URL check finds
`case-10-units` in the slug. The outlier gate confirms 12x the median.
Dashboard flags the store.

Three different kinds of self-healing, all managed by one agent, all with
a visible audit trail. The pitch: "the system does not just fix broken
scrapers — it validates its own understanding of the data."

## Scope and effort

### Must build (for the demo to work)

| Component | Effort | Notes |
|---|---|---|
| `title-check.ts` | ~20 lines | Non-food title keywords: easter, candy, chocolate, flavored, condensed, bubble, ornament, decorative, cosmetic, supplement |
| `url-check.ts` | ~10 lines | Wholesale URL slug regex |
| `outlier-check.ts` | ~25 lines | Median + threshold, skips when < 4 pins |
| `llm-validator.ts` | ~40 lines | One Claude call per pin, structured prompt |
| `gate.ts` | ~30 lines | Run all checks, collect findings |
| `gate.test.ts` | ~60 lines | The eight known false positives as fixtures |
| `heal-agent.ts` triage | ~30 lines | Switch on incident kind, dispatch |

Total: roughly 215 lines of new code, plus tests.

### Should build (strong demo value)

| Component | Effort | Notes |
|---|---|---|
| Audit trail writes | ~20 lines | `heal_attempts` insert for quality decisions |
| Dashboard quality view | ~50 lines | Render quality incidents in existing timeline |
| `basket_mismatch` + `price_outlier` incident kinds | ~5 lines | Shared types update |

### Can defer (describe in docs, demo with mockup)

| Component | Notes |
|---|---|
| Automated re-pick loop | Full `mapping-heal.ts` that searches catalogue and re-pins |
| `output-heal.ts` | Targeted Studio heal for size fields — same mechanism as scraper heal, different prompt |
| Scheduled quality audit | pg-boss job that runs the gate periodically |

## When the quality gate runs

Three options, each with a trade-off:

| Trigger | Pro | Con |
|---|---|---|
| On every scrape (ingest) | Catches issues immediately | Adds latency and LLM cost to every run |
| On basket mapping (rebuild) | Cheap, runs once per store | Does not catch drift between rebuilds |
| On demand (dashboard button) | Simplest to build | Weakest for "autonomous" narrative |

**Recommendation for the hackathon**: on basket mapping. It is autonomous
(no human trigger needed — the mapper calls the gate as its final step),
cheap (runs once per store rebuild, not per scrape), and demonstrable
(judges see the before/after in the audit trail).

Post-hackathon, the on-ingest path is the right one: every incoming price
gets a lightweight check (the three pure functions), and only flagged items
trigger the LLM call.

## Relationship to existing work

- **Spider-Sense** (`basketwatch/apps/api/src/modules/validator/checks.ts`):
  untouched. It stays pure, IO-free, and structurally focused. The quality
  gate is a separate module that runs after spider-sense passes.
- **Basket mapper** (`spencer-exploration/basket.py`): untouched on the
  Python side. The quality gate validates mapper output, it does not
  replace the mapper. When the mapper moves into the TypeScript app, the
  gate integrates directly.
- **Heal module** (`basketwatch/apps/api/src/modules/heal/`): already
  scaffolded in PR #9 with stubs for the orchestrator, budget guard, and
  Studio client. The heal agent extends these stubs rather than replacing
  them. The scraper heal strategy IS the orchestrator from
  `architecture.md`, now one strategy among four.
- **Contract** (`basketwatch/packages/contract/`): the ingest contract
  (`ingest.ts`) still has the v1 shape — `unit` non-nullable, no size
  fields, no `source`. The quality gate is more useful with size fields
  present, but the two can land in either order.
- **Clone store**: deleted in PR #11. The demo Act 1 (scripted
  break-and-heal) needs an alternative target. Spencer flagged this as
  an open decision in the PRD with three costed options.
- **Open items in `docs/index.md`**: the guard unification and contract
  update are prerequisites for a clean implementation but not blockers
  for the proposal itself.

## Implementation and testing safety

The deployed Postgres carries 28,378 products, 28,376 price observations,
and 340 basket pins — all real, all verified against live Shopify JSON.
Any integration or testing of the quality gate must not corrupt, overwrite,
or silently mutate this data.

### The workflow: local-first, promote to prod

The end-to-end sequence for safe integration:

```
Step 1  Snapshot prod
        pg_dump the deployed Postgres (the rollback path)
             |
Step 2  Restore into local Postgres
        docker compose dev up, load the dump
             |
Step 3  Unit tests (no database)
        The eight known false positives as fixtures
        Validates title-check, url-check, outlier-check, LLM prompt
             |
Step 4  Develop and iterate against local
        Run the gate with dryRun: true, inspect reports
        Flip dryRun: false, break things, verify, repeat
        Reset local with pg_restore as many times as needed
             |
Step 5  Dry-run against prod
        Point at deployed DB, dryRun: true (reads only, writes nothing)
        Produces a report — compare against the known eight issues
             |
Step 6  Team reviews the report
        Both people confirm findings, no false positives on correct pins
             |
Step 7  Write to prod
        dryRun: false against deployed DB, scoped to one store first
        Diff basket_map before/after, verify heal_attempts rows
             |
Step 8  Full write (all stores)
        Only after single-store write is confirmed clean
```

If anything goes wrong at Step 7 or 8, restore from the Step 1 snapshot:

```sh
pg_restore --clean --if-exists -d "$DATABASE_URL" snapshots/<file>.dump
```

### Supporting rules

#### Snapshots

Before any write-enabled test against the production database, take a
`pg_dump` snapshot:

```sh
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="snapshots/pre-quality-gate-$(date +%Y%m%d-%H%M%S).dump"
```

The `snapshots/` directory must be gitignored — add it to `.gitignore`
in the implementation PR. Dumps are ~5 MB compressed and take seconds
against 28K rows. Never commit a dump; it contains the database password
in its connection metadata.

#### Dry-run by default

Every quality gate function and heal strategy must support a `dryRun`
flag that defaults to `true`. In dry-run mode:

- The gate runs all checks and produces findings, but writes nothing.
- The mapping heal computes the re-pick, but does not update `basket_map`.
- The price heal flags outliers, but does not change `index_contributor`.
- All output goes to stdout or a local JSON report file, not the database.

The flag flips to `false` only when explicitly passed. No implicit writes.

```ts
interface QualityGateOptions {
  dryRun?: boolean       // default: true
  reportPath?: string    // write findings to this file instead of DB
  country?: Country      // scope to one country
  storeId?: string       // scope to one store
}
```

#### The gate never deletes

The quality gate and heal strategies may:

- Insert rows into `heal_attempts` (audit trail).
- Update `basket_map.status` and `basket_map.note` on flagged pins.
- Update `basket_map.product_key` when a re-pick is accepted.
- Insert rows into `incidents` for new quality incidents.

They must never:

- Delete rows from any table.
- Modify `products` or `price_observations`.
- Modify `stores` (including `index_contributor`) without explicit
  team approval — that changes the index composition.
- Truncate or replace `basket_map` wholesale; updates are per-pin.

#### Baseline diff

Before the first integration test, freeze the current basket state:

```sh
psql "$DATABASE_URL" -c "
  COPY (
    SELECT store_id, item_key, product_key, status, note
    FROM basket_map ORDER BY store_id, item_key
  ) TO STDOUT WITH CSV HEADER
" > snapshots/basket-map-baseline.csv
```

After any write-enabled run, diff against it:

```sh
psql "$DATABASE_URL" -c "
  COPY (
    SELECT store_id, item_key, product_key, status, note
    FROM basket_map ORDER BY store_id, item_key
  ) TO STDOUT WITH CSV HEADER
" > snapshots/basket-map-after.csv

diff snapshots/basket-map-baseline.csv snapshots/basket-map-after.csv
```

This is the human-readable record of what the gate changed.

#### Local-first for LLM development

The LLM validator prompt should be developed and iterated locally before
it touches any database path:

1. Export the eight known false positives as a JSON fixture.
2. Run the prompt against each fixture and inspect the responses.
3. Add edge cases: the duck egg (arguable), the coconut sugar (arguably
   a real sugar), the MerryMart case milk (correct product name, wrong
   price unit).
4. Tune the prompt until it correctly classifies all cases with clear
   reasoning.
5. Only then wire it into the gate's `llm-validator.ts`.

#### Local Postgres for integration tests

Prefer a local Postgres over the deployed one during development:

```sh
docker compose -f docker-compose.dev.yml up -d   # local postgres
pg_restore -d "postgres://basketwatch:basketwatch@localhost:5432/basketwatch" \
  snapshots/pre-quality-gate-*.dump                # restore snapshot
```

Run the gate against the local copy. When satisfied, proceed to Step 5
(dry-run against prod). This way a bug in the gate wipes a local copy,
not the team's shared data. Reset local at any time with
`docker compose -f docker-compose.dev.yml down -v` and re-import.

## Open questions for team review

1. Should the LLM validator use Claude Haiku (cheapest, fastest) or Sonnet
   (more reliable on edge cases like "Cooked Salt Duck Egg")? Haiku is
   likely sufficient for a yes/no classification.
2. Should the quality gate produce `heal_attempts` rows (reusing the
   existing table) or a new `quality_decisions` table? Reusing is simpler
   and keeps the audit timeline unified; a new table is cleaner
   semantically.
3. MexMax appears to be a wholesale-only retailer. Should the quality gate
   flag individual pins, or should we demote the entire store from
   `index_contributor` when > 50% of its pins are flagged?
