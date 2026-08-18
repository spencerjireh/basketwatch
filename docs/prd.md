# PRD: Basketwatch (working name)

v1 — confirmed Aug 18, 2026.
Companions: `architecture.md` (HLD), `hackathon-brief.md` (rules + findings).
Review artifact: https://claude.ai/code/artifact/f7cf34cf-af6e-4efd-8f76-16dd1865ef36

## 1. Product statement

A daily grocery basket price tracker across real store sites, built on a
fleet of Bright Data Scraper Studio scrapers. The differentiating promise is
reliability made visible — "the basket index that never lies": a
spider-sense layer validates every delivered run (schema, null-rates, row
counts, value drift, freshness), opens incidents with evidence when data
goes silently wrong, and an autonomous heal loop repairs the scraper through
Studio, verified by canary run, every step audited.

**Primary user: judges wearing both hats.** The consumer view (basket chart,
store comparison) must feel finished; the ops view (fleet health, incident
evidence, heal diffs) carries the engineering depth. When tradeoffs arise,
judging value decides.

## 2. Decisions (locked in team interview, Aug 18)

1. **Coverage**: US fleet is committed scope. PH sites join only if >= 2 vet
   cleanly by end of Aug 19; otherwise ship US-only with zero rework.
2. **Multi-country is architectural, not a feature**: country is a
   first-class dimension on stores, products, and baskets, with generalized
   currency handling. Adding any country's sites later immediately enables
   comparison; US-vs-PH is just the first instance.
3. **Headline story**: reliability-first ("the basket index that never
   lies"); the cross-country comparison is a feature, not the headline.
4. **All four extras are P0** (comparison view, Wayback replay rig, SSE live
   dashboard, Telegram + email alerts) with the cut order in section 4.
5. **Proof-of-healing bar**: the scripted clone-store break-and-heal is the
   required demo centerpiece. The pre-build HN heal is excluded from demo
   material. Organic incidents and Wayback replay are bonus evidence layers.
6. **US site selection**: mixed, authenticity-weighted — 2-3 real
   grocer/pharmacy sites plus easy online pantries, swapping toward
   authentic sites as they prove workable.

## 3. Scope

### Core (P0, never cut)
- Fleet of 4+ US scrapers plus the clone store, uniform output contract,
  scheduled 2x daily.
- Spider-sense validator opening incidents with evidence bundles.
- Autonomous heal loop: evidence -> Claude-composed prompt ->
  refactor_template -> auto-approve -> canary verify -> save or escalate;
  budget guard on every Studio call.
- Dashboard: basket index chart (gaps + heal markers), fleet board, basket
  table, engine activity feed. (v1 exists on mock data since Aug 18.)
- Full audit trail persisted; deployed live on the Coolify VPS.

### Extras (P0 by decision)
| Feature | Status | Notes |
|---|---|---|
| US-vs-PH comparison view | gated on PH sites | country-dimensioned data model ships regardless |
| Wayback drift-replay rig | feasibility test first | scraper built on archived page, run on today's |
| SSE live dashboard | P0 | runs and heals stream into the UI live |
| Alerts: Telegram + Resend email | P0, first cut | notifier interface stays regardless |

### Non-goals
- No auth or user accounts; no login/paywalled scraping; no human approval
  gates in the heal loop; no mobile app.
- HN born-broken heal story does not appear in the demo.

## 4. Cut order under time pressure

1. **Alerts** — ship one channel instead of two; interface stays.
2. **SSE** — fall back to auto-refresh polling.
3. **Comparison view** — ships as a plain table; country data model untouched.
4. **Wayback rig** — drop; clone store + any organic incident carry the proof.

The core loop and the clone-store demo are never cut.

## 5. The basket

Canonical items with per-store, per-country product mappings.

- **US**: eggs (dozen), whole milk (1 gal), white bread, rice (5 lb), ground
  coffee (12 oz), sugar (4 lb), chicken breast (per lb), cooking oil
  (48 oz), pasta (1 lb), bananas (per lb).
- **PH (if gated in)**: same categories localized — rice per kg as the
  anchor item, eggs per tray where sold, cooking oil 1L, instant coffee
  sachets. The comparison view normalizes per-unit where possible and
  discloses where it cannot.

## 6. Candidate sites to vet (Aug 18-19)

Vetting bar: public product pages, stable URLs, prices reachable by Studio,
absent from Bright Data's 800+ prebuilt scrapers, structurally diverse.
Cheap HTTP checks first; Studio credits only on survivors.

- **US (need 4+ survivors)**: FreshDirect, Weee! (authenticity anchors);
  Rite Aid (pharmacy); Vitacost, iHerb, Swanson (online pantries); H-E-B
  (try last, app-first risk).
- **PH (gate: 2+ survivors by Aug 19 EOD)**: Watsons PH, Southstar Drug
  (best odds); Landers, WalterMart Delivery (mid risk); PureGo, MerryMart
  (app-first risk).
- **Always in fleet**: Parker's Pantry (clone store on VPS subdomain) —
  disclosed test rig with layout-mutation switch.

## 7. Definition of done (Sat Aug 23)

- 5+ scrapers live with 4+ days of real price history charted.
- Clone-store break -> detect -> heal -> verify reproducible end-to-end,
  and runnable by a judge from the repo README.
- Dashboard deployed on a public URL with zero mock data.
- Demo video <= 3 min: problem, live product, the heal moment, audit trail,
  architecture beat.
- Submission filed: repo + video + description + Studio-usage writeup.

## 8. Open items

- C1: basket contents approval (esp. PH localization) — team.
- C2: PH gate deadline confirmed as Aug 19 EOD unless changed.
- C3: site list additions/vetoes — team.
- C4: real product name before the video; repo rename lands with it.
