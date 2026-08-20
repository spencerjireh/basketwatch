---
title: Experiment plan — heal prompt effectiveness
tags: [hackathon, brightdata, heal, experiment]
created: 2026-08-20
status: planned, not yet executed
---

# Heal prompt experiments

## Objective

Before building the heal agent's prompt generator, understand how Bright
Data's `scraper heal` responds to different prompt styles. The output is
a set of guidelines the agent follows when composing heal prompts.

Questions to answer:

1. **Specificity**: Does a high-level description ("prices are missing")
   work, or does the heal need selector-level detail ("price is in
   `.product-price > span`")?
2. **Expected output**: Does describing what the output *should* look
   like help, or is describing what's *wrong* sufficient?
3. **Context depth**: Does providing before/after examples or DOM
   structure improve success rate?
4. **Multi-field**: Can one prompt fix multiple broken fields, or is it
   better to heal one field at a time?
5. **Minimal viable prompt**: What is the shortest prompt that still
   produces a successful heal?

## What the docs already tell us

Collected from four official sources: the CLI docs, the skills repo
(`references/recipes.md`, `references/prompts.md`), the API reference,
and the official self-healing demo repo (`anil-bd/scraper-studio-self-
healing-demo`).

### Mechanic

- `scraper heal` calls `POST /dca/collectors/{id}/refactor_template`
  with a `prompt` string (max 1000 chars) and an optional `custom_input`
  array.
- The flow is async: trigger, poll progress, hit approval gate
  (`pending_answer` / `user_approval`), approve or reject, poll to done.
- `--auto-approve` skips the gate. Without it, the CLI exits with
  `status: "awaiting_approval"` and a `preview_result` showing sample
  output from the proposed fix.
- If the heal fails, the collector is unchanged — nothing is left
  half-built.
- Cost: 1 credit per page load (shared pool, not per record). A heal
  triggers at least one page load for the preview.

### What the docs say about prompts

From the CLI v0.3.1 release notes (emphasis in original):

> **You are the detector.** The CLI never decides on its own that a
> scraper is broken -- you inspect the run output and decide. A heal
> is slow, billable, and mutating.

> The `<prompt>` is **required** and is the most important input. Name
> exactly what is wrong and what the correct output should be: *"The
> price field returns null -- the selector moved into a `<span
> data-testid=...>`. Capture price and currency again."* **Vague
> prompts ("fix it") produce vague heals.**

From `prompts.md` (written for `create` but same principles apply):

- **Name each field explicitly.** Don't say "scrape this page."
- **Disambiguate location.** "The main product price near the title,
  not the prices in the recommendations sidebar."
- **Handle missing-field cases.** "original_price: null if no sale."
- **Pin the data type.** "price: number (not string), in USD."
- **Exclude noise.** "Skip sponsored/ad cards."
- Anti-patterns: "scrape this page", "give me everything", "extract
  data", multi-paragraph essays (field lists > prose).

### Official example prompts (verbatim from docs)

```
"The points and comment_count fields return null since the site
redesign. Re-capture them from the new markup."
```

```
"The price field returns null since the redesign. Re-capture price
and currency."
```

```
"Price returns null — the selector moved; capture price + currency."
```

```
"Price stopped extracting after the page redesign — it's now in
span.price-now"
```

```
"Reviews stopped extracting after the page redesign"
```

Pattern: **what broke** + **what to capture** (optionally + **where it
moved to**). All under 200 chars. None says "fix it" or describes the
full page structure.

### The self-healing demo (anil-bd)

The demo repo takes a `HEAL_PROMPT` env var and a `REQUIRED_FIELDS`
list. Its health check is: at least one row, with all required fields
non-empty. If broken, it posts the prompt to `refactor_template` and
polls. If the heal reaches `user_approval`, it exits code 3 for manual
review. The demo does NOT auto-approve.

The demo does NOT vary prompts -- it uses one fixed prompt per scraper.
This is the gap our experiments fill.

### The `custom_input` parameter

The API accepts a `custom_input` array alongside `prompt`. Not
documented beyond the schema definition. Unknown whether it accepts
sample rows, DOM fragments, or something else. Worth testing.

### What we still don't know (the experiments)

1. Is the selector-level detail in the example prompts *necessary* or
   just *sufficient*? Do high-level prompts work at all?
2. Does the heal engine do its own page analysis, or does it rely
   entirely on the prompt for context?
3. Does `custom_input` accept sample expected output?
4. How does the approval gate's `preview_result` quality vary with
   prompt quality?
5. Does a multi-field prompt produce worse results per field than a
   focused single-field prompt?

## Prerequisites

Before running any experiment:

- [ ] Install Bright Data CLI (v0.3.4+): `npm install -g brightdata`
  or `npm install -g bdata`
- [ ] Authenticate CLI: `bdata login` (needs browser) or
  `export BRIGHTDATA_API_KEY=...` (headless)
- [ ] Set `BD_SETTLE_MS=30000` in `.env` so per-heal cost is visible
- [ ] Confirm which account owns the test scrapers (Spencer's account
      holds the 16 existing ones; creating fresh ones on Edjin's account
      avoids touching production scrapers)
- [ ] Run `node lab/scripts/bd.mjs --report` to record the baseline

## Available scrapers

From the deployed Postgres as of Aug 20:

| Scraper | Status | Site | Notes |
|---|---|---|---|
| basketwatch-ph-smmarkets | healthy | smmarkets.ph | Single product page, good baseline |
| basketwatch-ph-merrymartwholesale | healthy | merrymartwholesale.com | Shopify, healthy |
| basketwatch-us-dierbergs | healthy | dierbergs.com | Has unit_price fields |
| basketwatch-us-hmart | healthy | hmart.com | Healthy |
| basketwatch-us-kesargrocery | healthy | kesargrocery.com | Healthy |
| basketwatch-ph-landers | suspect | landers.ph | Already degraded, natural test candidate |
| basketwatch-ph-ever | manual_attention | ever.ph | Broken, natural candidate |
| basketwatch-ph-shopgaisano | manual_attention | shopgaisano.com | Broken |
| basketwatch-ph-shopsuki | manual_attention | shopsuki.ph | Broken |
| basketwatch-us-amigofoods | manual_attention | amigofoods.com | Broken |
| basketwatch-us-cypressindian | manual_attention | cypressindiangrocery.com | Broken |
| basketwatch-us-latimex | manual_attention | latimexmarket.com | Broken |
| basketwatch-us-lilimart | manual_attention | shoplilimart.com | Broken |
| basketwatch-us-mexgrocer | manual_attention | mexgrocer.com | Broken |
| basketwatch-us-mexmax | manual_attention | mexmax.com | Broken, likely wholesale-only |
| basketwatch-us-sukli | manual_attention | sukli.com | Broken |

For the experiments, prefer using `manual_attention` scrapers: they are
already broken, so a heal attempt is productive (we learn something AND
potentially fix a real scraper). Healing an already-healthy scraper wastes
credits with no learning.

## Experiment design

### Round 1: prompt specificity (2 heal calls)

Pick one `manual_attention` Shopify scraper (e.g. `basketwatch-us-sukli`).
First, inspect the current scraper output to understand what is broken.

**1A — high-level prompt**:
```
This scraper is not extracting product data correctly. It should return
the product name, price, and availability for each product on the page.
```

**1B — specific prompt**:
```
The scraper targets a Shopify collection page. Product names are in
`.product-card__title`, prices are in `.product-card__price`, and the
product URL is in `.product-card__link`. Extract name, price (as a
number), currency, and the product URL for each product on the page.
```

**Record**: Did both succeed? Which produced cleaner output? Did the
specific prompt extract more fields correctly?

### Round 2: issue description vs. expected output (2 heal calls)

Same or different `manual_attention` scraper.

**2A — describe the problem**:
```
The price field returns null for all products. The scraper is not finding
the price element on the page.
```

**2B — describe the expected result**:
```
Each product should have a price field containing a number like 149.50.
The price is visually displayed on the product card next to the product
name. Extract it as a decimal number without the currency symbol.
```

**Record**: Which approach produced correct prices? Did 2B's example
value anchor the extraction or mislead it?

### Round 3: context depth (2 heal calls)

Pick a scraper where we know what changed (if possible, inspect the
page source before healing).

**3A — no context**:
```
The page layout changed and data is no longer being extracted.
```

**3B — structural context**:
```
The page previously had product data in a grid with class
`.product-grid__item`. The site has been updated and now uses
`.collection-product-card` for each product. The price is inside
a `<span class="money">` element. Adapt the scraper to the new
structure.
```

**Record**: Does providing DOM hints help the heal engine, or does
Bright Data's own page analysis make this redundant?

### Round 4: multi-field vs. single-field (2 heal calls)

Pick a scraper that extracts multiple fields (name, price, size, URL).

**4A — fix everything at once**:
```
This scraper should extract: product name, price as a number, size/weight
as printed on the page, and the product URL. Currently none of these
fields are populated correctly.
```

**4B — fix one field**:
```
The price field is empty. Extract the price as a decimal number from
the product page. The price is displayed near the product title.
```

**Record**: Does a multi-field prompt produce worse results per field
than a focused single-field prompt? If so, the heal agent should issue
multiple narrow heals rather than one broad one.

### Round 5: minimal prompt (1-2 heal calls)

**5A — bare minimum**:
```
Fix this scraper.
```

**5B — one-liner with target**:
```
Extract product name and price from this page.
```

**Record**: Does Bright Data's heal engine do its own page analysis
even with a vague prompt? How does the output quality compare to
Rounds 1-4?

## Methodology

For each heal call:

1. **Before**: Run the scraper once (`scraper run <id>`) to capture the
   current (broken) output. Save the raw JSON.
   ```sh
   node lab/scripts/bd.mjs --label=heal-exp-1a-pre -- scraper run <id> <url> --pretty -o scratch/heal-exp/1a-before.json
   ```
2. **Heal (no auto-approve)**: Run the heal WITHOUT `--auto-approve` so
   we can inspect the `preview_result` before committing. This is the
   key data point -- what did the heal engine produce from this prompt?
   ```sh
   node lab/scripts/bd.mjs --label=heal-exp-1a -- scraper heal <id> "<prompt>" --url <url> --pretty -o scratch/heal-exp/1a-heal.json
   ```
3. **Inspect**: Read `1a-heal.json`. Check `status` (should be
   `awaiting_approval`), examine `preview_result` (the sample output
   from the proposed fix). This is where we evaluate quality.
4. **Decide**:
   - If the preview looks correct: approve with
     `scraper approve <id> --url <url>`, then re-run to verify.
   - If the preview is wrong: reject with
     `scraper approve <id> --reject`. The scraper is unchanged, no
     harm done. Record what went wrong.
5. **Record** in the results table below:
   - Prompt text (verbatim)
   - `preview_result` quality (correct / partial / wrong)
   - Approved or rejected
   - If approved: did the re-run produce correct data?
   - Fields correctly extracted (name, price, size, URL, etc.)
   - Cost (from the guard report)
   - Time taken (from the guard report)
   - Observations (e.g. "heal fixed price but broke title")

The approval gate is the safety net. We never auto-approve during
experiments. A rejected heal costs the same credits (the page load
already happened) but leaves the scraper unchanged.

All commands go through the guard. Use `BD_SETTLE_MS=30000`.
`just guard` is a shortcut for `node lab/scripts/bd.mjs`:
```sh
BD_SETTLE_MS=30000 just guard --label=heal-exp-1a -- scraper heal <id> "<prompt>" --url <url> --pretty -o scratch/heal-exp/1a-heal.json
```

## Budget

| Item | Estimated cost | Count |
|---|---|---|
| Scraper runs (before/after) | ~$0.01-0.05 each | ~18 |
| Heal calls | ~$0.10-0.25 each | ~9-10 |
| **Total** | **~$1.00-3.00** | |

This is within the daily ceiling ($5) and well within the account
balance. The guard will refuse if we approach any cap.

## Decision: which account

Options:

1. **Use Spencer's account** (owns the 16 scrapers). Pro: heal real
   broken scrapers, productive. Con: spends from the account that
   already lost $26 to the Studio overrun.
2. **Use Edjin's account** (untouched, ~$52). Pro: fresh budget. Con:
   need to create new scrapers first (additional cost, ~$0.05-0.10
   each), and the experiments don't fix real scrapers.
3. **Hybrid**: create 1-2 test scrapers on Edjin's account for the
   risky experiments (Round 5 bare minimum), use Spencer's for the
   ones likely to succeed and fix real scrapers.

Recommend option 3. The low-specificity prompts (Round 5) are the
most likely to waste a heal call, so use the fuller-balance account.
Rounds 1-4 are likely to produce working scrapers, so run those
against the real fleet.

## Expected output

A findings doc (`docs/heal-prompt-guidelines.md`) with:

1. **What works**: which prompt style produced the best results
2. **What doesn't**: which style wasted credits
3. **Guidelines for the heal agent**: a template or set of rules the
   prompt generator follows, e.g.:
   - Always include the expected output schema
   - Always mention the site platform (Shopify, Magento, etc.) if known
   - Prefer single-field heals over multi-field
   - Minimum viable prompt is X
4. **Cost model**: actual cost per heal so the budget guard can be tuned

These guidelines feed directly into `heal.orchestrator.ts` — the
triage function decides the strategy, and then the prompt generator
follows these rules to compose the heal description.

## Bonus round: `custom_input` (if budget allows)

The API accepts a `custom_input` array alongside `prompt`. No
documentation beyond the schema. Worth one test:

**6A** — pass `custom_input` with a sample expected row:
```json
{
  "prompt": "Extract product name and price",
  "custom_input": [
    {"name": "Jasmine Rice 5kg", "price": 12.99, "currency": "USD"}
  ]
}
```

This would need to go through the API directly (`curl` or the demo
repo), not the CLI, since `--custom-input` is not a documented CLI
flag. If it works, it means the heal agent can pass the last-good
output as context, which would dramatically improve heal accuracy.

## Reference projects worth studying

### bandiradar (mayai-it/bandiradar)

A competing hackathon entry with a self-healing architecture. Their
approach differs from ours: they model the crawl as DATA (a
`CrawlRecipe`), not code, and the LLM proposes new recipes. The key
innovation is a **golden guard**: a candidate recipe is adopted only if
it exactly reproduces the last-good results. Otherwise it's flagged for
human review, never auto-applied.

Relevance to our experiments: their guard principle ("the LLM proposes,
a deterministic check decides") is the same pattern our approval gate
follows. If our experiments show that `preview_result` is reliable
enough to auto-approve, we can skip the gate in production. If not, we
keep it.

### anil-bd/scraper-studio-self-healing-demo

The official Bright Data demo. Simple flow: scrape, health-check
(required fields non-empty), heal if broken, re-scrape. Single fixed
prompt per scraper. Their health check is binary (fields present or
not), which means they cannot detect semantic issues like our quality
gate does.

## Results table (fill during execution)

| Round | Variant | Scraper | Prompt (abbreviated) | Preview quality | Approved? | Re-run correct? | Cost | Time | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1A | high-level | | | | | | | | |
| 1B | specific | | | | | | | | |
| 2A | problem | | | | | | | | |
| 2B | expected | | | | | | | | |
| 3A | no context | | | | | | | | |
| 3B | structural | | | | | | | | |
| 4A | multi-field | | | | | | | | |
| 4B | single-field | | | | | | | | |
| 5A | bare min | | | | | | | | |
| 5B | one-liner | | | | | | | | |
| 6A | custom_input | | | | | | | | |
