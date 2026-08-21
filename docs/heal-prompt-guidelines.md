---
title: Heal prompt guidelines
tags: [hackathon, brightdata, heal, guidelines]
created: 2026-08-21
updated: 2026-08-21
---

# Heal prompt guidelines

Rules for composing prompts that the heal orchestrator sends to Bright
Data's `scraper heal` engine. Derived from structured experiments on
Sukli (Shopify) and validated against Dierbergs (custom site) during
Phase 1 integration testing. Full experiment data is in
[heal-test-findings.md](../lab/edjin-exploration/heal-test-findings.md).

## Results table

| Round | Prompt style | Prompt (abbreviated) | Success | Preview | Code changes | Cost | Time | Notes |
|---|---|---|---|---|---|---|---|---|
| R1A | High-level | "Not extracting correctly. Should return name, price, availability." | Yes | 1 row, all correct | title: fragile class -> h1. price: added .first(). availability: added new field. | $0.72 | ~3 min | Added a field the scraper didn't have |
| R1B | Specific selectors | "Titles use h1. Prices in product-price .price span. Add availability from cart button." | Yes | 1 row, all correct | title -> h1. price -> .first(). Removed image_url, added availability. | $0.40 | ~1.5 min | Followed instructions literally, dropped unrequested image_url |
| R2A | Problem description | "Price returns null. Title uses fragile auto-generated class." | Yes | 1 row, all correct | title -> h1.first(). price -> .first(). All existing fields preserved. | $0.46 | ~1.5 min | Minimal, targeted changes |
| R2B | Expected output | "Title like 'Ajinomoto...', price as decimal like 4.95, image_url, product_url. Use stable selectors." | Yes | 1 row, all correct | title -> h1.first(). price -> .first(). image -> new selector. Removed product_page_url. | $0.32 | ~1.5 min | Restructured output to match described schema |
| R3A | No context | "Page layout changed. Scraper needs updating for new structure." | Timeout | 0 rows | Stuck at css_selector_extractor (478/600 attempts) | ~$0.50+ | >10 min | Same failure as mexgrocer: vague prompt = engine loops |
| R4A | Multi-field fixes | "Fix: (1) title -> h1. (2) price .first(). (3) image selector. (4) Add availability." | Yes | 1 row, all correct | All 4 changes applied exactly as listed. | $0.24 | ~1.5 min | Cheapest and fastest. Numbered list = clear instructions. |
| R4B | Single-field fix | "Price returns null. Fix price selector to extract decimal." | Yes | 1 row, price correct | Only price selector changed. All other fields untouched. | $0.48 | ~3 min | Scoped precisely, no side effects. |
| R5A | Bare minimum | "Fix this scraper." | "Yes" | 1 row, price=None | No code changes at all. | ~$0.00 | ~30s | Engine ran existing code, called it done. Useless. |

## Key findings

### 1. Specificity matters, but the engine does its own analysis

The heal engine inspects the live page DOM regardless of what the
prompt says. It does not blindly apply suggested selectors -- it
cross-checks them via `css_selector_extractor` and
`request_fulfillment_validator`. This means:

- **You don't need exact selectors.** R1A said "should return
  availability" without specifying any CSS. The engine found the
  cart button and wrote the extraction logic itself.
- **But the engine does follow selector hints.** R4A's numbered
  list with specific selectors was applied exactly.
- **Vague prompts waste time.** R3A ("page layout changed") sent
  the engine into a loop trying every possible selector combination.
  R5A ("Fix this scraper") produced no changes at all.

### 2. Describe what's broken, not what changed

R2A (problem description) produced the cleanest, most conservative
fix: only the broken fields were touched, everything else was
preserved. R2B (expected output) restructured the output to match
the described schema, which removed a field (`product_page_url`).

**Guideline**: the heal agent should describe what's wrong with the
current output, not what the final output should look like. The latter
risks the engine dropping existing fields that weren't mentioned.

### 3. Multi-field prompts work well

R4A proved that a single prompt can fix multiple fields simultaneously.
The numbered-list format was the cheapest ($0.24) and fastest (~1.5 min)
experiment. The engine applied all 4 changes without confusion.

**Guideline**: the heal agent should batch related fixes into one prompt
using a numbered list. No need for one heal per field.

### 4. Vague prompts are dangerous

| Prompt | Result |
|---|---|
| "Fix this scraper." (R5A) | No changes, price=None, reported success |
| "Page layout changed." (R3A) | Infinite loop in css_selector_extractor, timeout |
| "Not extracting correctly, should return X, Y, Z." (R1A) | Success |

The threshold is: the prompt must name **at least one specific field**
or **at least one specific issue**. "Fix this" and "layout changed"
are below the threshold. "Price returns null" or "should return
availability" are above it.

### 5. The engine is conservative by default

When the prompt mentions specific fields, the engine only touches those
fields. R4B ("fix price") changed only the price selector. R2A ("price
null, title fragile") changed only price and title. The engine does not
do unsolicited refactoring.

**Guideline**: the heal agent can trust that a focused prompt will not
break unrelated fields.

### 6. Complex sites cause timeouts

Both mexgrocer (heavy Shopify with custom JS) and the vague R3A prompt
caused the heal engine to loop at `css_selector_extractor` for 400-600
attempts before timing out. The engine struggles when it cannot
determine which selectors to try.

**Guideline**: for complex sites, the heal agent must provide more
specific hints (selector names, field locations) to reduce the search
space. If a heal times out, escalate to manual IDE intervention or
try a more targeted prompt.

### 7. Cost varies with prompt clarity

| Prompt clarity | Avg cost | Avg time |
|---|---|---|
| Numbered list with selectors (R4A) | $0.24 | ~1.5 min |
| Specific field + issue (R2B, R4B) | $0.40 | ~2 min |
| High-level with fields named (R1A, R2A) | $0.59 | ~2 min |
| Vague (R3A) | $0.50+ timeout | >10 min |

More precise prompts = fewer internal iterations = lower cost.

## Prompt template for the heal agent

Based on these findings, the heal agent should compose prompts using
this template:

```
Fix these issues with the scraper:

(1) <field_name> returns <current_bad_value>. <What it should return>.
    [Optional: the data is in <selector_or_location>.]

(2) <field_name> <problem_description>.
    [Optional: use <specific_selector>.]

(N) Add <new_field_name>: <description of what to extract>.
```

Rules:
- Always name the broken field explicitly.
- Describe the problem (returns null, wrong value, missing) not the
  page structure.
- Use a numbered list for multiple fixes.
- Include selector hints when available (from stored template code)
  but don't rely on them -- the engine validates them anyway.
- Never use "fix this scraper" or "page layout changed" alone.
- Keep under 500 chars. The 1000-char limit is generous; our best
  results were all under 300 chars.

## What this means for the heal agent

**The prompt generator does not need an LLM.** Bright Data's heal
engine is itself an AI pipeline (planner, code_fixer,
css_selector_extractor, request_fulfillment_validator) that analyzes
the live page and rewrites the scraper code. Our job is only to
describe what's broken -- and the experiments showed that a
deterministic numbered list outperformed every "intelligent" prompt
style. The prompt is string interpolation from the validator output:

```typescript
const items = brokenFields.map((f, i) =>
  `(${i + 1}) ${f.name} ${f.symptom}.${f.selectorHint ? ` ${f.selectorHint}.` : ''}`
)
const prompt = `Fix these issues:\n\n${items.join('\n')}`
```

The only scenario where an LLM might compose a better prompt is the
escalation path: when a template-based prompt times out on a complex
site and the agent needs to analyze the stored scraper code and the
page DOM to write a more targeted instruction. That is an edge case,
not the default path.

1. **Triage decides, prompt follows.** The spider-sense validator
   detects which fields are broken (null, wrong type, drift). The
   prompt generator maps each broken field to a numbered item.

2. **Batch related fixes.** Don't issue one heal per field. A single
   numbered-list prompt handles multiple fields cheaply.

3. **Include template context when available.** If the heal agent
   has the stored template code (from the last heal's `diff.template_a`),
   it can include selector names in the prompt for faster resolution.

4. **Skip the minimal prompt.** "Fix this scraper" is never worth
   trying. Always name at least one specific field.

5. **Set a timeout.** If a heal doesn't reach `pending_answer` within
   5 minutes, reject and retry with a more specific prompt. Don't let
   it loop for 10+ minutes burning credits.

6. **Auto-approve is safe for simple fixes.** R4A's multi-field fix
   was perfect. For high-confidence prompts (numbered list, known
   selectors), `auto_save: true` can skip the approval gate. Reserve
   manual review for complex sites or first-time heals.

## Related documents

- [Heal test findings](../lab/edjin-exploration/heal-test-findings.md) --
  full experiment data and Phase 1 integration test results.
- [Heal integration plan](plans/heal-integration-plan.md) --
  the phased pipeline plan built on these guidelines.
- [Heal prompt experiments](../lab/edjin-exploration/heal-prompt-experiments.md) --
  original experiment design and methodology.
