---
title: Bright Data Scraper Studio -- API and capability reference
tags: [hackathon, brightdata, reference]
created: 2026-08-21
sources:
  - https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/overview
  - https://docs.brightdata.com/api-reference/scraper-studio-api/list-scrapers
  - https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/create-scraper-template
  - https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/trigger-ai-flow
  - https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/trigger-self-healing
  - https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/self-healing-job-progress
  - https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/resume-self-healing-job
  - https://docs.brightdata.com/datasets/scraper-studio/self-healing-tool
  - https://docs.brightdata.com/datasets/scraper-studio/develop-a-scraper
  - https://docs.brightdata.com/datasets/scraper-studio/ai-agent
  - https://docs.brightdata.com/datasets/scraper-studio/functions
  - https://docs.brightdata.com/datasets/scraper-studio/specifications
  - https://docs.brightdata.com/datasets/scraper-studio/build-with-the-cli
  - https://github.com/brightdata/skills/blob/main/skills/scraper-studio/references/api-flow.md
  - https://github.com/anil-bd/scraper-studio-self-healing-demo
---

# Bright Data Scraper Studio -- API and capability reference

Comprehensive reference for creating, reading, modifying, and healing
scrapers via the Bright Data Scraper Studio platform. Compiled from the
official docs, the skills repo, and our own experimentation.

All endpoints are under `https://api.brightdata.com`.
Auth: `Authorization: Bearer $BRIGHTDATA_API_KEY`.

---

## Endpoint map

| Phase | Method | Path | Body / params | Returns |
|---|---|---|---|---|
| Create entity | `POST` | `/dca/collector` | `{ name, deliver }` | Full collector incl. `id: c_*` |
| AI code gen | `POST` | `/dca/collectors/{c_*}/automate_template` | `{ description (max 500), urls (max 1) }` | `{ id: ia_*, queued }` |
| AI gen progress | `GET` | `/dca/collectors/{c_*}/automate_template/progress` | -- | `{ step, completed_steps, status }` |
| List scrapers | `GET` | `/dca/collectors_list?search=` | -- | `{ total, offset, limit, data: [...] }` |
| Self-heal trigger | `POST` | `/dca/collectors/{c_*}/refactor_template` | `{ prompt (max 1000), custom_input?: [] }` | 200 (job accepted) |
| Self-heal progress | `GET` | `/dca/collectors/{c_*}/refactor_template/progress` | -- | `{ id, status, step, diff?, preview_result? }` |
| Approve / reject | `POST` | `/dca/collectors/{c_*}/resume_automation_job` | `{ message: bool, auto_save?: bool }` | 200 |
| Batch run | `POST` | `/dca/trigger?collector={c_*}&queue_next=1` | `[{ url }, ...]` | `{ collection_id: j_* }` |
| Realtime run | `POST` | `/dca/trigger_immediate?collector={c_*}` | `{ url }` | `{ response_id: r_* }` |
| Sync run | `POST` | `/dca/crawl?collector={c_*}&timeout=50s` | `{ url }` | Rows inline or 202 + `response_id` |
| Batch results | `GET` | `/dca/dataset?id={j_*}` | -- | 202 building / 200 `[rows]` |
| Realtime results | `GET` | `/dca/get_result?response_id={r_*}` | -- | `[rows]` |
| Job log | `GET` | `/dca/log/{job_id}` | -- | `{ Status, Success_rate, Lines, Pages, ... }` |

---

## 1. Creating scrapers

### Via API (three chained calls)

**Step 1 -- create entity.**

```
POST /dca/collector
{ "name": "my-scraper", "deliver": { "type": "webhook", "endpoint": "..." } }
```

Returns `{ id: "c_...", ... }`. The `id` is the `collector_id` used
in all subsequent calls. Persists even if AI generation fails.

**Step 2 -- trigger AI generation.**

```
POST /dca/collectors/{collector_id}/automate_template
{ "description": "Extract product name, price...", "urls": ["https://example.com/page"] }
```

- `description` max 500 chars.
- `urls` max 1 element.
- Returns `{ id: "ia_...", queued: boolean }`.

**Step 3 -- poll until done.**

```
GET /dca/collectors/{collector_id}/automate_template/progress
```

Returns `{ step, completed_steps, status }`. Steps in order:
`user_intent_analyzer`, `planner`, `discovery`, `collector_maintainer`,
`output_schema_generator`, `code_generator`, `input_schema_generator`,
`preview_runner`, `preview_picker`.

Typical time: 5-25 minutes. Default poll timeout: 600 seconds.

**The progress endpoint does NOT return the generated code.** Only step
status. The generated code is only visible in the web IDE.

### Via CLI

```sh
bdata scraper create <url> "<description>" --name <name> --pretty -o output.json
```

Flags: `--name`, `--deliver-webhook`, `--timeout` (default 600s),
`--max-retries`, `-o` for JSON output.

### Via UI

Scraper Studio AI Agent chat at `https://brightdata.com/cp/scrapers`.
Paste a URL, describe the data, approve the schema, AI writes the code.
Supports five scraper types: PDP, Discovery, Discovery+PDP, Search,
Sitemap.

---

## 2. Reading / listing scrapers

### List scrapers

```
GET /dca/collectors_list?search=<term>
```

Returns `{ total, offset, limit, data }` where each scraper has:
`id`, `name`, `active`, `last_run`, `deliver`, `output_schema`.

**Does NOT return**: template code, parser code, interaction code,
step definitions, version history.

### Viewing scraper code -- confirmed gap

There is **no API endpoint** to retrieve the scraper's JavaScript
template (interaction code + parser code). There is **no CLI command**
(`scraper view`, `scraper export`, etc.).

The template is only viewable in the Scraper Studio web IDE at
`https://brightdata.com/cp/scrapers/{collector_id}`.

### Workaround: heal-and-reject to read code

Trigger a minimal heal, read `diff.template_a` from the approval gate,
then reject. Scraper stays unchanged. Cost: one page load (~$0.01-0.05).

```sh
bdata scraper heal <id> "Inspect current state" --url <url> -o template.json
# Read diff.template_a from template.json
bdata scraper approve <id> --reject
```

This is the only programmatic path to the template code.

---

## 3. Modifying / editing scrapers

### Via Self-Healing API

**Trigger:**

```
POST /dca/collectors/{collector_id}/refactor_template
{ "prompt": "Price returns null -- fix the selector", "custom_input": [] }
```

- `prompt` max 1000 chars. Required.
- `custom_input` accepts an array of objects. Format undocumented beyond
  the schema type.

**Poll progress:**

```
GET /dca/collectors/{collector_id}/refactor_template/progress
```

While running:

```json
{ "id": "ia_...", "step": "code_fixer", "completed_steps": [...], "status": "running" }
```

At approval gate:

```json
{
  "id": "ia_...",
  "step": "user_approval",
  "status": "pending_answer",
  "diff": {
    "template_a": { ... },
    "template_b": { ... },
    "title": "View refactor changes",
    "user": "user@example.com"
  },
  "preview_result": [{ "title": "...", "price": 9.95, ... }],
  "success": true
}
```

**Approve or reject:**

```
POST /dca/collectors/{collector_id}/resume_automation_job
{ "message": true }           // approve
{ "message": false }          // reject
{ "message": true, "auto_save": true }  // approve and save to production
```

`auto_save: true` saves the template to production automatically once
the job completes. Only applies when `message` is `true` and the job
succeeds.

### Via CLI

```sh
bdata scraper heal <id> "<prompt>" --url <url>       # trigger
bdata scraper approve <id> --url <url>               # approve
bdata scraper approve <id> --reject                  # reject
bdata scraper heal <id> "<prompt>" --auto-approve    # skip gate
```

### Via IDE (direct code editing)

Open the scraper at `https://brightdata.com/cp/scrapers/{collector_id}`.
Edit interaction code and parser code directly in JavaScript. Run
preview to test. "Save to Production" publishes changes.

Version history is available via the "Versions" menu in the IDE
(rollback to earlier versions). No API for version management.

### Schema modification

- Auto-detected from parser code when fields change.
- Manually editable via "Edit Schema" in the IDE.
- Self-Healing can add/remove fields; IDE prompts "Update Schema"
  before saving to production.
- No direct API for schema-only changes.

### What cannot be done via API

- No `PUT /dca/collector/{id}` to push code directly.
- No endpoint to update individual parser or interaction code blocks.
- No endpoint to read or write the output schema.
- No endpoint to manage version history.
- All code changes must go through either Self-Healing (AI-mediated)
  or the IDE (manual).

---

## 4. The heal (self-healing) process

### Flow

1. **Trigger**: `POST .../refactor_template` with prompt.
2. **Poll**: `GET .../refactor_template/progress` until terminal state.
3. **At approval gate** (`pending_answer` / `user_approval`): response
   includes `diff` (before/after templates) and `preview_result`.
4. **Approve or reject**: `POST .../resume_automation_job`.
5. If approved, poll progress again until `status: "done"`.

### Heal pipeline steps (observed)

| Step | Purpose |
|---|---|
| `planner` | Analyzes the prompt and current scraper state |
| `control_preview_runner` | Runs the existing scraper to get baseline output |
| `code_fixer` | Modifies the code based on the prompt |
| `step_preview_runner` | Runs the modified code to test it |
| `request_fulfillment_validator` | Checks if the output matches the prompt intent |
| `css_selector_extractor` | Extracts/validates CSS selectors from the live page |
| `agent_picker` | Selects the right AI agent for the task |
| `html_diff` | Computes the diff between templates |
| `step_advance` | Moves to the next pipeline step |
| `user_approval` | Pauses for human review |

### What the diff contains

At `pending_answer`, `diff` is an object with:

- `template_a` -- full current template as JSON
- `template_b` -- full proposed template as JSON
- `title` -- human-readable diff title
- `user` -- email of the user who triggered the heal

Each template is a JSON object with a `steps` array. Each step contains:

| Field | Description |
|---|---|
| `code` | Interaction JavaScript (navigate, wait, collect) |
| `parse_code` | Parser JavaScript (CSS selectors, data extraction) |
| `parser.id` | Parser slot identifier (`p_...`) |
| `input` | Sample input URLs |
| `fields` | Input field definitions |
| `features` | Capabilities used (`cmd.navigate`, `cmd.parse`, etc.) |

### Prompt guidelines (from official docs)

From the CLI docs (emphasis original):

> "The prompt is **required** and is the most important input. Name
> exactly what is wrong and what the correct output should be. Vague
> prompts produce vague heals."

Effective patterns (from official examples):

- "The price field returns null since the redesign. Re-capture price
  and currency."
- "Price stopped extracting after the page redesign -- it's now in
  span.price-now"
- "The points and comment_count fields return null since the site
  redesign. Re-capture them from the new markup."

Pattern: **what broke** + **what to capture** (optionally + **where it
moved to**). All under 200 chars. None says "fix it" or describes the
full page structure.

Anti-patterns: "scrape this page", "give me everything", "extract data",
multi-paragraph essays (field lists are better than prose).

### Behaviors observed in experiments

| Scenario | Behavior |
|---|---|
| Healthy scraper + vague prompt ("Inspect current state") | Proposes NO code changes (template_a === template_b) |
| Healthy scraper + misleading selector prompt | Self-corrects to a working selector; does NOT blindly follow bad instructions |
| Broken scraper + vague prompt ("Inspect current scraper code") | May propose changes that make output WORSE (0 rows instead of broken data) |
| Complex sites (e.g. mexgrocer.com) | Heal engine gets stuck at `css_selector_extractor`, timing out at 600 attempts |

### Costs

- Billing is CPM (per 1,000 page loads).
- Each heal triggers at least one page load for the preview.
- File downloads billed separately per GB.
- Rejected heals still cost (the page load already happened).
- If refactoring takes >15 minutes, an email notification is sent.

---

## 5. Running scrapers

### Three run modes

| Mode | Endpoint | Body | Returns | Use case |
|---|---|---|---|---|
| Batch async | `POST /dca/trigger?collector={c_*}&queue_next=1` | `[{ url }, ...]` | `{ collection_id: "j_*", start_eta }` | Multiple URLs, can wait |
| Realtime async | `POST /dca/trigger_immediate?collector={c_*}` | `{ url }` | `{ response_id: "r_*" }` | Single URL, poll for result |
| Realtime sync | `POST /dca/crawl?collector={c_*}&timeout=50s` | `{ url }` (single, not array) | Rows inline or 202 + `response_id` | Single URL, need result now |

### Receiving results

- Batch: `GET /dca/dataset?id={collection_id}` -- 202 while building,
  200 with `[rows]` when ready.
- Realtime: `GET /dca/get_result?response_id={response_id}`.

### Auto-fallback

If a realtime run exceeds the page-load limit (typically 51 pages), the
CLI silently falls back to batch mode and polls `GET /dca/dataset`.

### Data retention

- Batch results: 16 days.
- Realtime results: 7 days.
- Export before expiry; Bright Data does not recover expired data.

### Infrastructure limits

- Up to 100 parallel batch jobs per scraper.
- 50K realtime requests/min per customer.
- Job queue is unlimited.

---

## 6. Scraper Studio functions reference

Key functions available in scraper JavaScript code.

### Interaction code

| Function | Purpose |
|---|---|
| `navigate(url, options)` | Load a page. Options: `allow_status`, `timeout` |
| `wait(selector)` | Wait for an element to appear |
| `parse()` | Run the parser code, return its result |
| `collect(data)` | Append a record to the output dataset |
| `next_stage(input)` | Pass input to the next step (multi-step scrapers) |
| `rerun_stage(input)` | Re-run the current step with new input (pagination) |
| `load_more(selector)` | Scroll/click for infinite scroll pages |
| `dead_page(reason)` | Mark a page as invalid (404, redirect) |
| `set_lines(data)` | Set output lines (overrides previous calls) |
| `request(url, opts)` | Make an HTTP request (JSON APIs, background data) |
| `tag_response()` | Capture background API responses (browser worker only) |

### Parser code

| Function / API | Purpose |
|---|---|
| `$(selector)` | Cheerio/jQuery selector |
| `.text_sane()` | Clean text extraction (Bright Data extension) |
| `new Money(value, currency)` | Price object for structured price output |
| `new Image(url)` | Image object for structured image output |
| `new URL(href, base)` | URL construction |
| `location.href` | Current page URL |
| `status_code()` | HTTP status code of the loaded page |

### Worker types

| Type | Speed | When to use |
|---|---|---|
| Code worker | Faster | Static HTML, public JSON endpoints |
| Browser worker | Slower | JS-rendered pages, clicks, scrolling, popups, captured traffic |

Start with code worker. Switch to browser worker if data is not in the
raw HTML response or if browser-only functions are needed.

---

## 7. CLI reference

Install: `npm install -g @brightdata/cli` (or `npx -p @brightdata/cli bdata`).

| Command | Purpose |
|---|---|
| `bdata login` | Authenticate via browser |
| `bdata scraper create <url> "<desc>"` | Create scraper with AI |
| `bdata scraper run <id> <url>` | Run scraper |
| `bdata scraper heal <id> "<prompt>"` | Trigger self-healing |
| `bdata scraper approve <id>` | Approve heal diff |
| `bdata scraper approve <id> --reject` | Reject heal diff |
| `bdata budget` | Check account balance |
| `bdata budget balance` | Get balance as JSON |

Common flags: `--pretty`, `-o <file>`, `--json`, `--sync`, `--timeout`,
`--url`, `--auto-approve`, `-k <api-key>`.

Env var `BRIGHTDATA_API_KEY` is used when set (headless, no login
needed).

---

## 8. ID prefixes

| Prefix | What | Issued by |
|---|---|---|
| `c_*` | Collector / scraper template | `POST /dca/collector` |
| `t_*` | Template version | Server-generated |
| `p_*` | Parser slot | Server-generated |
| `ia_*` | AI job (create or heal) | `POST .../automate_template` or `.../refactor_template` |
| `j_*` | Batch collection ID | `POST /dca/trigger` |
| `r_*` / `z*` | Realtime response ID | `POST /dca/trigger_immediate` or 202 from `/dca/crawl` |

---

## 9. Capability matrix

| Capability | API | CLI | IDE | Notes |
|---|---|---|---|---|
| Create scraper | Yes | Yes | Yes | Full support |
| List scrapers | Yes | No | Yes | Metadata only, no code |
| View scraper code | **No** | **No** | Yes | Heal-and-reject workaround |
| Edit code directly | **No** | **No** | Yes | Manual JS editing in browser |
| Push code via API | **No** | **No** | N/A | No PUT endpoint |
| Heal (AI-mediated) | Yes | Yes | Yes | Full support |
| Approve / reject heal | Yes | Yes | Yes | `auto_save` option |
| Version rollback | **No** | **No** | Yes | "Versions" menu in IDE |
| Schema editing | **No** | **No** | Yes | Auto-detected on save |
| Run scraper | Yes | Yes | Yes | 3 modes |

---

## 10. Implications for the heal agent

1. **All code modifications must go through Self-Healing.** There is no
   way to programmatically push code. The agent's workflow is: diagnose
   -> compose prompt (max 1000 chars) -> trigger heal -> inspect diff
   -> approve or reject.

2. **Template visibility requires heal-and-reject.** On first deploy,
   the agent captures every scraper's template with a one-time sweep.
   Subsequently, each heal cycle's `diff.template_a` confirms the
   stored version is current.

3. **`auto_save: true` enables one-step deploy.** For high-confidence
   fixes, the agent can approve and deploy in one API call.

4. **Prompt quality is critical.** Vague prompts on broken scrapers can
   make output worse. The agent must always include: what field is
   broken, what the correct output looks like, and optionally where the
   data is on the page.

5. **Complex sites may time out.** The heal engine can get stuck on
   sites with heavy DOM or SPA rendering. The agent should detect
   timeout patterns and fall back to manual IDE intervention or a
   different prompt strategy.

6. **No version rollback API.** The agent must track template versions
   locally (in Postgres) because the IDE version history is not
   API-accessible.
