---
title: Heal test findings -- Phase 1 integration testing
tags: [hackathon, brightdata, heal, experiment]
created: 2026-08-21
account: test account (61ea7f02-...)
scrapers: heal-exp-sukli (c_mt2anl8x8toit6mod), heal-exp-dierbergs (c_mt2tbzqh202mga8hiw)
---

# Heal test findings

End-to-end integration testing of the Phase 1 heal endpoints against
real data, and a head-to-head comparison of auto-generated (numbered-
list) prompts vs manually crafted LLM-style prompts. All heals were
rejected -- no scrapers were modified.

Prompt construction rules derived from these findings are in
[docs/heal-prompt-guidelines.md](../../docs/heal-prompt-guidelines.md).
The pipeline integration plan built on these conclusions is in
[docs/plans/heal-integration-plan.md](../../docs/plans/heal-integration-plan.md).

## Setup

- Local Postgres synced from production via `pg_dump` (19 stores,
  28,591 products, 28,643 observations). Production untouched.
- Dev server started with local `DATABASE_URL` override.
- Test account scrapers: `heal-exp-sukli` (c_mt2anl8x8toit6mod),
  `heal-exp-dierbergs` (c_mt2tbzqh202mga8hiw, created for this test).
- All heal diffs were **rejected** -- no scrapers were modified.

## Data quality baseline

| Scraper | size_null % | Product types | Legitimate nulls? |
|---|---|---|---|
| Dierbergs | 95.9% (373/389) | Deli, bakery, cakes, party items | Yes -- 0/373 have parseable size in title |
| Shop Gaisano | 44.5% | Mixed grocery + clothing/toys | Partial -- non-grocery items are legitimate |
| MexMax | 25.9% | Mixed food + wholesale/non-food | Partial -- dimensions, not weight/volume |
| Sukli | 8.0% (332/4151) | Filipino grocery (Shopify) | Mostly no -- some have size in title |

## Test 1: Sukli -- Phase 1 vs LLM-style

**Phase 1 auto-generated prompt:**
```
Fix these issues:
(1) size_value returns null (8% null-rate).
(2) size_uom returns null (8% null-rate).
```

**LLM-style prompt (manually crafted from data analysis):**
```
Fix size_value and size_uom extraction. Size data appears at the end of
product titles in formats like: "50 G", "12oz", "6pcs", "245 G",
"3.09 OZ", "18x11g" (multiply: 18*11=198g). Parse these from the title.
For products where no weight/volume/count is present in the title
(figurines, appliances, lotion, generic items), leave size_value and
size_uom as null. Do not extract capsule or teabag counts as size.
```

| Dimension | Phase 1 | LLM-style |
|---|---|---|
| Duration | 98s | 48s |
| Preview (Ajinomoto 18x11g) | 198g (correct) | 198g (correct) |
| Handles "fl oz" | No | Yes |
| Handles "pcs" | No | Yes |
| Handles unicode multiply sign | No | Yes (`[xX\u00d7]`) |
| Null guard on title | No | Yes (`if (title)`) |
| UoM normalization | `.toLowerCase()` | `.toLowerCase().replace(/\s+/g, ' ').trim()` |

Both produced working code, but the LLM-style prompt generated more
robust extraction with more unit types, defensive null checks, and
whitespace normalization. It also ran 2x faster (the engine needed
fewer internal iterations with clearer instructions).

## Test 2: Dierbergs -- Phase 1 vs LLM-style

**Phase 1 auto-generated prompt:**
```
Fix these issues:
(1) size_value returns null (96% null-rate).
(2) size_uom returns null (96% null-rate).
```

**LLM-style prompt (manually crafted from data analysis):**
```
Extract size_value and size_uom ONLY when the product name contains an
explicit weight, volume, or count like (4ct), 48 Oz, 12 oz. Most
Dierbergs products are deli items, custom cakes, party platters, and
prepared foods that have no standardized size -- for these, size_value
and size_uom must remain null. Do not guess or infer sizes.
```

| Dimension | Phase 1 | LLM-style |
|---|---|---|
| Duration | 87s | 242s |
| Data source | DOM selectors only | JSON-LD first, DOM fallback |
| Size extraction approach | Regex on title + secondary element | Regex on title only (strict) |
| Guard against false sizes | No -- would match SKU numbers like "(24724)" | Strict unit suffix required |
| Image extraction | Broken (null) | Fixed via JSON-LD `ld_json.image` |
| Price source | DOM only | JSON-LD with DOM fallback |

The LLM-style prompt produced significantly better code: JSON-LD
extraction (more reliable than DOM), strict size matching that won't
false-positive on SKU numbers, and a bonus image_url fix.

## Test 3: Dierbergs -- the triage gap

The strongest finding: **neither prompt was the right answer for
Dierbergs.** An LLM triage agent with access to the data would have
concluded:

> 373 out of 373 null-size products have no parseable size anywhere in
> the title. These are deli items, custom cakes, party platters, and
> funeral sprays. The 96% null rate is correct behavior, not a scraper
> bug. **Decision: skip heal entirely.**

Phase 1 has no triage logic -- it triggers on any threshold breach.
This is the primary gap the next phase must address.

## Bug found and fixed

The orchestrator stored `verdict = "pending"` (a string) instead of
leaving it `null` when status was `pending_answer`. This caused
`findPendingAttempt` (which queries `verdict IS NULL`) to fail,
breaking the approve/reject flow. Fixed by only calling
`finishAttempt` when the status is not `pending_answer`.

## Test cost summary

| Test | Target | Credits | Balance impact |
|---|---|---|---|
| Sukli Phase 1 | heal-exp-sukli | ~$0.00 | None |
| Sukli LLM-style | heal-exp-sukli | ~$0.00 | None |
| Dierbergs scraper creation | heal-exp-dierbergs | ~$0.00 | None |
| Dierbergs Phase 1 | heal-exp-dierbergs | ~$0.00 | None |
| Dierbergs LLM-style | heal-exp-dierbergs | ~$0.00 | None |
| **Total** | | **~$0.00** | $47.94 unchanged |

All heals were rejected. Shopify and Dierbergs heal previews appear
to cost negligible credits (below the resolution of the balance API).

## Earlier experiment cost summary

From the initial prompt experiments on heal-exp-sukli (before Phase 1
testing). Full results table is in
[docs/heal-prompt-guidelines.md](../../docs/heal-prompt-guidelines.md).

| Category | Cost |
|---|---|
| Successful heals (R1A, R1B, R2A, R2B, R4A, R4B) | ~$2.62 |
| Failed/timeout heals (R3A, R5A) | ~$0.50 |
| Mexgrocer heals (both failed) | ~$7.56 |
| Sukli collection baseline (accidental crawl) | ~$1.86 |
| Other baselines and overhead | ~$0.50 |
| **Total experiment spend** | **~$13.04** |

## Conclusions

1. **Phase 1 works for simple, clear-cut cases** (Sukli: real
   extraction gaps on a consistent product catalogue).

2. **Phase 1 fails on mixed stores** (Dierbergs: legitimate nulls
   treated as bugs, would waste credits or break the scraper).

3. **LLM-style prompts produce better code** even when Phase 1 would
   be correct to trigger: more unit types, defensive checks, JSON-LD
   discovery.

4. **The biggest gap is triage, not prompt quality.** The question
   "should we heal at all?" is more valuable than "how should we
   word the prompt?" The next phase should add an LLM triage layer that
   examines sample products before deciding to trigger.

5. **Cost is not a concern for Shopify stores.** All four heal
   previews cost effectively nothing. Complex sites (mexgrocer) remain
   expensive from earlier experiments.
