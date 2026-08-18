# Into the Scrape-Verse — Hackathon Brief

Source: https://www.wemakedevs.org/hackathons/scrape-verse
Dates: August 17-23, 2026 (online or SF). Team: solo or up to 4.
Organizer: WeMakeDevs. Title sponsor: Bright Data.

## Core challenge

Build web scrapers that repair themselves when websites change layout,
then use that data to build something meaningful.

**Bright Data Scraper Studio is mandatory** and must be central to the project.

## Tracks (every submission auto-considered for all three)

| Track | Criterion | Prize |
|---|---|---|
| Web-Slinger (grand) | Best use of Bright Data: scraper design, coding agent integration, self-healing, structured output | NVIDIA DGX Spark ($5k) or $5k cash |
| Suit-Up | Best UI: looks/feels finished, data presentation | iPad per member |
| Spider-Sense | Best clean code: readable, structured, edge cases handled | Keychron per member |

## Judging criteria (equal weight)

1. Potential impact — solves a clear, useful problem
2. Creativity and innovation — original approach to web-data collection
3. Technical excellence — complete, reliable, well-structured
4. Use of Scraper Studio — central to the project
5. Reliability and self-healing — handles site changes and extraction failures
6. Presentation — clearly explains problem, workflow, output, product

## Rules

- Public web data only; no login-protected, paywalled, or private data
- AI coding tools allowed; must understand and verify the code

## Submission

GitHub repo + demo video + project description + explanation of Scraper Studio usage + form.

## Scraper Studio facts (from docs/research)

- AI-powered scraper builder: give a URL + description of data, it generates
  and deploys a working scraper (JavaScript, editable in a web IDE).
- Self-Healing tool: plain-language prompt -> AI proposes a code diff ->
  review/accept -> preview -> save to production. UI-only per current docs
  (no documented API/CLI trigger for healing itself). Refactor can take up
  to 15 min. Works on scrapers saved in development mode.
- Free tier: 5,000 credits/month. Promo code `wemakedevs` = +$50 credits.
- Bright Data also ships an official CLI (github.com/brightdata/cli) for
  scrape/search/extract from the terminal.

## Experiment findings (Aug 15)

- [x] CLI (`@brightdata/cli` v0.3.4) covers the whole loop: `scraper create`,
  `scraper run`, `scraper heal` (with `--auto-approve --auto-save` = fully
  autonomous healing), `scraper approve`. Healing is NOT UI-only.
- [x] Underlying REST endpoints (api.brightdata.com): `/dca/collector` (create
  template), `/dca/collectors/<id>/automate_template` (AI generate),
  `refactor_template` (heal), `resume_automation_job` (approve/resume),
  `/dca/trigger`, `/dca/trigger_immediate`, `/dca/crawl` (sync), `/dca/get_result`.
  Watchdog backend can call these directly, no CLI shell-out needed.
- [x] `scraper run <id> <url> --sync` works end-to-end: returned clean JSON
  from a saved scraper. Execution engine is NOT gated.
- [x] Scrapers can deliver via webhook (`--deliver-webhook`) — event-driven design possible.
- [x] `brightdata add mcp` installs Bright Data MCP into Claude Code/Cursor;
  `brightdata skill` manages agent skills. Ammo for "coding agent integration".
- [x] Test runs cost ~nothing: balance still $50.00 after several preview/sync runs.

## Day-1 findings (Aug 17)

- Verification UNBLOCKED (Bhaskar from Bright Data cleared it after email).
- Full loop proven end-to-end on collector c_msxak9lb21yj6b9tf9 (HN test):
  - AI create: ~6.5 min, pipeline steps visible during polling (intent ->
    schema -> codegen -> preview) — dashboard can show these live.
  - First AI-generated scraper shipped silently half-broken: ~85% of rows
    empty, no error raised. Perfect narrative + validator justification.
  - `scraper heal --auto-approve --auto-save` fixed it autonomously:
    0% empty rows after, 93% fully populated (7% partial = HN job posts
    with no points/author — legitimately missing).
- Cost of everything so far: $0.24 (balance $49.76). Credits are a non-issue
  if scrapers stay bounded.
- LESSON: creation descriptions must bound crawl scope explicitly — "top 30
  stories" crawled ~150 pages (4,470 rows) because it didn't say stop.
  Price scrapers target fixed product URLs. Add row-count ceiling check.
- New 4th track announced: "Daily Bugle" — best LinkedIn documentation
  (Galaxy Watch). Post build-in-public updates during the week.
- Organizer tip: target niche sites lacking pre-built scrapers (avoid
  Amazon/Walmart — 800+ prebuilt exist). Regional grocers/pharmacies it is.
- Schedule: user has 9h work block Thu Aug 20 ("AI Bootcamp Capstone") —
  polish work may need to shift Wed evening / Fri morning.

## RESOLVED BLOCKER (was: as of Aug 15)

- All AI features (AI create `automate_template`, AI chat, presumably heal)
  return 403 "Automation not allowed" — account-level gate, both API and UI,
  until account verification is approved. Verification form submitted (twice),
  pending review. If not approved by Aug 16, email contact@wemakedevs.org and
  file a Bright Data ticket (brightdata.zendesk.com).
- Fallback if verification drags: hand-write scraper code in the Studio IDE
  (works fine) and drive run/heal-approve via API once unlocked.
- Cleanup: delete orphaned draft collectors c_mst98nji1s5i7hpd23,
  c_msta47n824rz4ktiko, c_mstoeqqqhoymxwrma (c_mstog9q62pf1hput7t kept as the
  saved smoke-test scraper).
