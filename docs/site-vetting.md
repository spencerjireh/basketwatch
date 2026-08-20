---
title: Site vetting — the browser pass over the registry
tags: [hackathon, vetting]
created: 2026-08-20
status: reconciled against spencer-exploration/registry.json
---

# Site vetting: the browser pass

**This document is not the fleet decision.** The fleet is
`spencer-exploration/fleet.lock.json`, scored from
`spencer-exploration/registry.json` (163 candidates, 32 fleet-ready, PH gate
passed with 9). This is a second, independent pass run in a real browser over
19 of those candidates, and it exists to answer one question the registry
cannot: what is on the sites its collectors never actually reached.

Both passes ran on the same days without knowledge of each other. Where they
agree, the agreement is worth more than either alone. Where they disagree,
this file says so and proposes the edit rather than making it.

The whole pass cost nothing: local Chromium, no Bright Data calls except the
five Unlocker probes recorded at the end, which moved the balance by less than
a cent.

## Why a browser pass exists

Two findings drove it, and both are methodological rather than about any one
site.

**A price that is not in the HTML is not a missing price.** An HTTP-only pass
rejected Landers on a 10kb empty shell. Rendered in a browser it is a full
online superstore with all ten basket staples carrying unit sizes in their
titles. Scraper Studio drives a real browser, so the honest test is what a
browser sees. The registry reached the same conclusion by a different route
and has `ph-landers` as fleet-ready, Studio-only.

**`basket_coverage: 0` in the registry means unmeasured, not measured zero.**
Every site whose `access_path` is `unlocker` or `none` carries coverage `0`
with an empty `basket_items` map and a default score of 69, which parks it as
`backup`. That is correct bookkeeping — the collector genuinely saw nothing —
but a reader scanning the registry will read those zeros as evidence about the
site. They are evidence about the collector. Five such sites were measured
here.

**The coverage number over-reports either way.** It is a keyword match over
product titles. Southstar's "milk" is Ensure Gold powdered milk and its "rice"
is Johnson's baby lotion; Watsons' "sugar" is a lip balm. Read the sample
product names before trusting any count, including the ones below.

## What this changes

Proposed registry edits, none applied. Coverage figures are staples matched
with a parseable unit size, out of the ten in `docs/prd.md` section 5.

| Site | Registry says | Browser found | Proposed |
|---|---|---|---|
| Weee! (`sayweee.com`) | `reject`, score 15, blocked, never reached | 10/10 staples with sizes, prices in static HTML | **promote to fleet-ready or bench** |
| Watsons PH | `backup`, unmeasured | 6/10, but the matches are cosmetics, not groceries | keep as backup, note the false matches |
| FreshDirect | `backup`, unmeasured | product pages carry JSON-LD and real prices via Unlocker | keep as backup, coverage now known-good |
| Pickaroo | `backup`, unmeasured | prices render; URLs are merchant- and branch-scoped | keep as backup, expensive to build |
| Metromart | `reject`, blocked | prices render, but markup splits the decimal (₱11000 for ₱110.00) | keep as reject, confirmed messiest |
| H-E-B | `backup`, unmeasured | Bright Data itself refuses the site without KYC | **demote to reject** — unavailable to us at any price |
| S&R (`snrshopping.com`) | `fleet_ready`, on the PH bench | catalogue renders, but prices appeared to sit behind a membership login | **verify before promoting** — see below |

### Weee! is the correction that matters

The registry rejected it at score 15 as `blocked via none`, meaning no access
path got in. A headed browser got in on the first try and measured 10/10
staples, with the unit in the product title — "Organic Valley Whole Milk Half
Gallon", "C&H Pure Cane Sugar 4 lb", "Nishiki Premium Medium Grain Rice 15
lb". Prices are in the listing HTML as well as on product pages, so the cheap
scrape unit is available.

This matters beyond one row because Weee! is the largest US Asian grocery
retailer, and the registry's own US thesis is that ethnic grocers are the
index source — the same reasoning that put H Mart, Kesar, MexGrocer, Lilimart
and Sukli in the fleet. Weee! belongs in that group and was excluded by a
collector failure rather than by a judgement.

One constraint: robots.txt disallows `*/search` and `*/promotion/top-x/*`, so
the scrape unit must be product URLs or `/en/category/...` listings.

### S&R needs a second look before it is promoted

The registry has `ph-snr` as fleet-ready and on the PH bench on the strength
of a server-rendered fetch with 3/10 coverage. A manual browser look found the
catalogue rendering but prices behind a membership login. If that holds, S&R
is out under the public-data-only house rule regardless of how cleanly it
scrapes. It is on the bench rather than in the fleet, so nothing depends on it
today, but it should not be promoted without someone confirming a price is
visible while logged out.

## Where the two passes agree

Agreement here is independent confirmation, not duplication.

- **Landers** is the strongest PH target and needs a browser. Both passes
  found 10/10 coverage; both found no unauthenticated API. Evidence from this
  side: `Bounty Fresh Omega-3 Enriched Premium Egg 10s` at ₱136.95, `Arla
  Organic Full Cream Milk 1L` at ₱141.25, and a `/dairy-chilled` category page
  rendering 42 products with 81 prices. Caveat worth carrying into the
  collector: some sitemap URLs are stale and 404 into an empty render, so
  category listings are the safer scrape unit and a suddenly empty product
  page should be read as a delisting, not a break.
- **Vitacost and Swanson** scrape cleanly — both fleet-ready in the registry,
  both PASS here. The caveat is semantic, not technical: they are health-food
  retailers, so their staples are substitutes. Vitacost's "eggs" is Egg
  Replacer and its "bread" is a bread mix. Fine for fleet diversity, weak as
  basket contributors.
- **Southstar** is scrapeable with low grocery value, at 3/10 real staples.
- **WalterMart, Robinsons Supermarket, Puregold, All Day and Rustan's Fresh**
  fail from both directions. Rustan's serves an expired certificate, Puregold
  only answers at the apex because `www` serves a broken chain, and the rest
  are corporate sites with no public storefront at the domain tried.

Two apparent disagreements are not disagreements. The registry's
`ph-merrymartwholesale` and `ph-smmarkets` are different hosts from the
`merrymart.com.ph` and corporate domains rejected here — the registry found
the real storefronts, including SM Markets' public Magento GraphQL endpoint.
Its hostnames win.

## Where this pass was wrong

Recorded so the next reader weights the table correctly.

- **S&R was marked UNREACHABLE by the script** on a navigation failure. The
  registry fetched it directly without trouble. The script was wrong; the
  concern above about the login wall comes from the manual look, not from that
  run.
- **Rite Aid and Swanson** returned 403 and a redirect loop on two runs, then
  answered normally an hour later. Treat single-run bot-wall verdicts from
  this pass as provisional.

## Unlocker probes (five calls)

Balance was $52.00 before and after with no pending charge. Saved HTML is in
`edjin-exploration/raw/`.

| Site | Call | Outcome |
|---|---|---|
| iHerb | `--country us`, search "eggs" | unblocked: 48 product links with `itemprop=price`. Supplements, not groceries |
| FreshDirect | `--country us`, product page | unblocked: JSON-LD plus visible prices. A real grocer target |
| Rite Aid | `--country us`, search "milk" | our search URL was wrong; a later browser pass hit a Cloudflare block from the PH IP |
| Landers | `--country ph`, homepage | 10kb shell — the SPA, not a block. Superseded by the browser pass |
| H-E-B | `--country us`, search "milk" | **refused by Bright Data**: residential access needs KYC for this site |

The H-E-B refusal is the useful one. The site is unavailable to us at any
price, which is a firmer reject than any score.

The `captcha` string flagged by the HTML analyser on every page is an inline
script reference, not a challenge. All four delivered pages returned real
content.

## Reproduce

From `edjin-exploration/`:

```sh
npm install
node vet.mjs                    # tier 0 (robots + sitemap) then tier 1 (browser)
node vet.mjs --only=Landers     # one site
node vet.mjs --rescore          # recompute verdicts from vet.json, no network
```

Results are committed in `edjin-exploration/vet.json`, with the per-site
staple URLs in `vet-seed.md`. Saved Unlocker HTML is in
`edjin-exploration/raw/`, which is gitignored. The browser runs headed by
default, because headless tripped a Cloudflare challenge on Landers that a
headed window did not; `--headless` opts back in.

Twenty round-2 candidates in `vet.json` carry the verdict `NOT RUN`: they got
a tier-0 probe before the sweep was stopped, once it became clear the registry
already covered them. Their robots and sitemap data is real; they have no
browser evidence.
