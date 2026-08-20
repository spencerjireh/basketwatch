# Site exploration and vetting

Finds and grades US and PH sites worth putting behind a Bright Data Scraper
Studio scraper for Basketwatch. Cheap HTTP checks first; Bright Data credits
only on the sites those checks cannot settle.

## Why three verdict classes, not two

A candidate is not simply "works" or "doesn't":

| Class | Meaning | What it costs to scrape |
|---|---|---|
| `server_rendered` | price is in the raw HTML (JSON-LD, microdata, or plain currency strings) | cheapest and most stable |
| `spa_empty` | page returns 200 but renders prices client-side | viable - Studio runs a real browser - but more fragile and more expensive |
| `blocked` | 403/429/challenge, or the connection never lands | needs Web Unlocker on every run |

Landers.ph is the worked example: 200 OK, a 17,000-URL sitemap, and 10/10 basket
items discoverable - but its product pages are 10KB of shell markup with no price
anywhere, direct or through the Unlocker.

## Files

| File | What it is |
|---|---|
| `studio.py` | **the Studio transport** - creates collectors, runs them in batches, maps their rows |
| `studio-collectors.json` | **the collector registry** - the only store-to-collector mapping that exists |
| `catalogue.py` | **the fallback puller** - every product a store sells, priced, over plain HTTP |
| `store.py` | **the SQLite store** - schema, migration, queries, JSON export |
| `catalogue.db` | **the catalogue** - stores, products, change-only price history, runs, incidents |
| `catalogue/` | per-store JSON, regenerated on demand by `--export-json` (gitignored) |
| `fleet.lock.json` | **the locked fleet** - the decision about what ships, held by hand |
| `items.json` | **the item registry** - 20 tracked items, units, per-country match terms |
| `basket.py` | picks one concrete product per item per store, and computes unit price |
| `basket-map.json` / `.md` | the per-store pin table - which product each store is tracked on |
| `manual-basket.json` | hand corrections where automated selection chose a lookalike |
| `HANDOFF.md` | what the app has to absorb; deliberately not applied here |
| `candidates.json` | the seed list - hand-authored, expanded by SERP discovery |
| `vet.py` | tier 0: free HTTP probes, robots, sitemaps, basket mapping, classification |
| `bd_tier1.py` | tier 1: Web Unlocker sweep over what tier 0 could not settle, with a hard credit ceiling |
| `score.py` | merges both tiers into the scored registry |
| `registry.json` | **the deliverable** - every candidate, scored, with evidence |
| `registry.md` | human scorecard, PH gate verdict, recommended fleet |
| `tier0.json` / `tier1.json` | raw evidence behind the registry |
| `test_vet.py` | tests for the pure vetting logic - every case is a bug this harness shipped |
| `test_basket.py` | tests for size parsing, unit-price maths and staple matching |
| `test_store.py` | tests for the DB: the run-summary invariant, identity, export shape |
| `test_studio.py` | tests for the Studio transport: descriptions, price coercion, identity |
| `raw/` | cached HTTP responses (gitignored) so re-runs cost nothing |

## Running it

```bash
# tier 0 - free, no credits, safe to re-run (responses are cached)
uv run spencer-exploration/vet.py
uv run spencer-exploration/vet.py --only PH          # one country
uv run spencer-exploration/vet.py --ids ph-landers   # one site
uv run spencer-exploration/vet.py --no-cache         # force refetch

# tier 1 - spends Bright Data credits, hard ceiling enforced
set -a; . ./.env; set +a
uv run spencer-exploration/bd_tier1.py --cap-usd 5.0

# score, audit the lock, and build the registry
uv run spencer-exploration/score.py

# pull whole catalogues
uv run spencer-exploration/catalogue.py --transport http
uv run spencer-exploration/catalogue.py --ids ph-ever --max-pages 2

# build the per-store basket from items.json
uv run spencer-exploration/basket.py
uv run spencer-exploration/basket.py --ids ph-shopgaisano

# tests
uv run --with pytest --with 'httpx[http2]' pytest \
  spencer-exploration/test_vet.py spencer-exploration/test_basket.py -q
```

`bd_tier1.py` reads the live account balance before it starts and re-checks it as
it goes; it stops the sweep the moment spend reaches `--cap-usd`. Between balance
reads it also tracks a deliberately pessimistic per-call estimate, so a burst
cannot overshoot the ceiling in the gap.

## The lock

`fleet.lock.json` is the fleet. It is written by hand, not produced by a picker, so
re-running the harness cannot quietly change what ships. Every entry carries why it
is in, its risk level, a named bench substitute, and any caveat that has to be
handled before its numbers enter the basket index.

`score.py` audits the lock on every run and reports drift: a locked site that is no
longer fleet-ready, whose robots.txt changed, or that vanished from the registry.
Drift appears both on stdout and as a callout at the top of `registry.md`.

That guard has already paid for itself once. A clean re-probe reclassified Grocery
Outlet from `server_rendered` to `spa_empty` - its original verdict rested on a
homepage banner image the product-URL scorer mistook for a product page. The audit
flagged it and Meijer, the named bench substitute for that slot, took its place. The
swap is recorded in the lock's `changelog`.

## Tracker and index

Two layers, and they compose.

The **tracker** is `catalogue.py`: it pulls every product a store sells, priced and
unit-priced. 17,746 products across 13 stores at last run, 15,260 with a unit price.
Method per store comes from the `catalogue` block in `fleet.lock.json` - Shopify
`/products.json`, Magento GraphQL, WooCommerce, or a sitemap walk.

The **index** is the 20 pinned items in `items.json`, which become a selection over
those catalogue rows rather than a separate scrape. The basket can never disagree with
the catalogue it is drawn from.

Every store declares a **page ceiling** in the lock, checked before each fetch. That is
a hard stop regardless of what the store serves, and it is the direct answer to the
unbounded description that once crawled ~150 pages and 4,470 rows. `max_pages` counts
API pages (~250 products each) for API methods and individual product pages for sitemap
methods.

History is **change-only**: a price row is written when a product's price moves. Every
run also appends a summary to `runs.jsonl` - rows, pages, coverage, ceiling reached -
which is what lets `checkRowCount` tell a truncated pull from a genuine mass price move.
Without it a short pull would look like everything went free.

A store returning zero rows has one of two different causes, and they are worth
distinguishing rather than lumping together:

- **Client-rendered** - the pages exist but hold no price in raw HTML. Landers is the
  only confirmed case: 0 rows from 300 pages, and no price even through the Unlocker.
  Flagged `needs_browser`; its catalogue needs the Studio transport.
- **No public product catalogue** - the sitemap holds no product URLs at all. The Fresh
  Market publishes 50 URLs of gift cards and recall notices; Wegmans publishes 175
  landing pages. Both are `method: none`, alongside Meijer.

I originally labelled all three `needs_browser` by assuming a zero-row pull meant
rendering. Re-running them disproved it for two of the three.

## The item registry and unit pricing

`items.json` holds the tracked items - 20 of them, with units, per-country target
sizes, localised match terms (bigas, itlog, gatas, mantika) and category hints.
Nothing about the basket lives in code, so adding an item or a country is a data edit.

The **core tier is exactly the `docs/prd.md` section 5 basket**, so the headline index
is unchanged and nothing already built is invalidated. The **stretch tier** adds ten
more - pork, fish, cheese, produce, canned sardines, bottled water - which broadens
the tool from a basket index into a price checker.

Item selection follows the CPI Manual and ONS criteria: expenditure weight, price
variability within the group, representativeness, continuous availability, and a
precise specification. Allocation uses PH FIES 2018 food shares (bread and cereals
11.0%, meat 5.7%, fish 5.0%). Units mirror Numbeo's published specs wherever an item
overlaps, so their figures stay usable as an external sanity check. Fish is included
despite Numbeo omitting it entirely, because it is near parity with meat in PH
spending.

**Unit price is the comparison primitive.** Raw prices across different pack sizes are
not comparable, which is why unit pricing is legally mandated on grocery shelves in
the EU, Australia and ~17 US states. Almost nobody publishes it in markup - of every
cached product page here, only Dierbergs and WebstaurantStore do - so `basket.py`
parses size out of the product title and computes it. It handles fractions ("1/4 Kg"
is 250 g, not 4 kg), multipacks ("12 x 2g" is 24 g), ranges, fluid ounces and bare
counts, and **refuses to guess** when a unit names a bundle of unknown contents such
as "6 Pack". A missing unit price beats a wrong one.

Two guards keep the picks honest beyond keyword lists:

- **Category gating** - a store's own taxonomy is stronger than any word list.
  "Sugar Kids Girls' Grace Sandals" reads as sugar to a text matcher; its category
  path never does.
- **Unit-family matching** - bottled water is measured in millilitres, so a 200 g pick
  is the wrong product whatever its title claims. This catches a class of lookalikes
  that no word list would.

Beyond those, two more gates were forced by real false positives. A weighed or
measured item **must state a size** - SM Markets answers "sugar" with girls' shoes and
"coffee" with a tee in Dark Coffee, and neither names a pack size, while food sold by
the gram always does. And a parsed size must be **plausible for the staple**: Pringles
Sweet Onion is 100 g, Piknik Potato is 55 g, and produce is not sold that way. Brand
blocklists never converge on this; pack size separates the two cleanly.

Unit prices are also cross-checked against the same item at other stores in the same
country. A pick far off its peers is usually a case or multipack sold as one line -
flagged for review, never auto-dropped.

## Search APIs

A store's own search beats every keyword heuristic, because it ranks over the real
catalogue. Shop Gaisano only mapped cleanly because it is Shopify. `vet.py` therefore
probes each candidate for Shopify (`/search/suggest.json`), Magento (`/graphql`) and
WooCommerce (`/wp-json/wc/store/products`), and `basket.py` uses whichever it finds.

The probe **parses the response body** rather than trusting the status code. Landers
and Meijer answer 200 on all three paths because their SPA serves `index.html` for
anything; only reading the body reveals there is no API there.

## Scoring

Weighted out of 100: reachability 20, price extractability 25, structured-data
quality 15, URL stability and sitemap depth 10, basket coverage 15,
robots-friendliness 10, novelty 5.

- `fleet_ready` >= 70, `backup` 50-69, `reject` < 50.
- A site whose robots.txt disallows the product path is `excluded` outright
  rather than merely penalised - the hackathon rule is public data only.
- `novelty` is docked for brands Bright Data almost certainly ships a prebuilt
  scraper for; the organizers explicitly asked for long-tail targets.

`structural_class` (json-ld / microdata / bare-html / spa-with-state) is tracked
so the chosen fleet spans different extraction shapes. A fleet that is five
JSON-LD Shopify stores proves far less about self-healing than one spanning four
different markup styles.

## Proven end to end

Three finalists were taken all the way through Scraper Studio and validated with this
repo's own validator, not by eye:

| Site | Collector | Result |
|---|---|---|
| Shop Gaisano (PH) | `c_mszan6wx1bgpc7941r` | `priceRecordSchema` PASS, `validateRun` = `ok` |
| SM Markets (PH) | `c_msyxrpa82470hx65c9` | `priceRecordSchema` PASS, `validateRun` = `ok` |
| Dierbergs (US) | `c_msyxuy2519vvn3139s` | `priceRecordSchema` PASS, `validateRun` = `ok` |

SM Markets is the interesting one. Its pages are `spa_empty` - no price in the raw
HTML, not even through the Web Unlocker - yet the Studio scraper returned a clean
contract-shaped row on the first attempt, because Studio drives a real browser.
That is why `spa_empty` is scored as workable-but-costlier rather than rejected.

To reproduce:

```bash
set -a; . ./.env; set +a
brightdata scraper run c_msyxrpa82470hx65c9 \
  "https://smmarkets.ph/10103348-batangas-coffee-brew-500g.html" --sync --pretty
```

## Studio is the collector; the puller is the fallback

Every row collected before 2026-08-20 came from `catalogue.py` over plain HTTP. Studio
had produced three single-product proof rows. That is backwards for a project judged on
Scraper Studio being central, and it also means the self-healing loop can only ever
apply to what Studio actually collects - Studio heals its own JavaScript collectors and
has no reach into our Python.

So the transport flipped. `catalogue.py` keeps everything it is good at - discovery,
page ceilings, size parsing, unit pricing, dedup, change detection - and only the fetch
moves. Studio is handed a bounded URL list and returns structured rows.

When a collector fails, the puller covers, and the substitution is recorded in the data:
`price_observations.source` says `puller`, the run row says so, and an incident opens.
The series stays unbroken and the fallback is never silent.

### What the pilot cost, and what it found

ph-landers was the pilot because it is the only fleet store with no alternative: 0 rows
from 300 pages of HTTP, no price in raw HTML even through the Web Unlocker. Anything it
produces is attributable to Studio and nothing else.

The generated collector shipped broken - hostname as the product name, no price,
`in_stock: false` for everything, no error raised. One
`scraper heal --auto-approve --auto-save` fixed it, and the same five URLs then returned
Baguio Canola Oil 1.5L at PHP 228.00 (PHP 152.00/L) and Baguio Pure Coconut Oil 1.8L at
PHP 385.50 (PHP 214.17/L). Four of five; the fifth still returns the hostname.

**The whole pilot - one create, two batch runs, one full AI heal - cost $0.02.**

Three things it found that planning did not:

- A product-page collector emits no `url` field, because the page it was handed *is* the
  product. The URL exists only on the echoed trigger payload, which was being stripped
  as non-data. Every row was silently dropped.
- Prices arrive as whatever the page showed: `"PHP 389.50"`, `"1,234.00"`,
  `"Price on request"`. A price that will not coerce drops the row.
- The collector returned size `"1G"` for a product titled `"1Gal."`. That parses cleanly
  as one gram and priced the oil at PHP 799,950 per kilo. Conflicting sizes now emit no
  unit price at all - a missing one is a visible gap, a wrong one poisons every
  comparison the product exists to make.

### Two CLI facts worth knowing before scripting against it

Both were verified in the CLI's own source, and both are wrong in the obvious reading:

- **`--timeout` is an attempt count, not seconds.** `polling.js` loops
  `attempt < timeout_seconds` and the batch poll interval is 10,000 ms, so the batch
  default of `3600` polls for **ten hours**. Pass an explicit count and wrap it in a
  deadline.
- **There is no `scraper list`.** `studio-collectors.json` is the only store-to-collector
  mapping in existence, which is why creation writes the id *before* verification, and
  why `.gitignore`'s `studio-*.json` needed an explicit negation - that pattern is the
  most plausible reason the first three collectors' descriptions were lost.

## Why the catalogue is a database

The per-store JSON had an oddity worth naming: the snapshot file was simultaneously the
output *and* the source of previous prices, so change detection depended on the thing it
was supposed to produce. It also could not answer any question spanning two stores.

`catalogue.db` holds stores, products, change-only `price_observations`, `runs` and a
reserved `incidents` table. Three properties are structural rather than conventional:

- **A run summary lands every time**, even at zero changes, with `run_id` mandatory on
  every observation. That is what keeps "nothing moved" distinguishable from "the pull
  was truncated" - without it a store returning 40 rows instead of 1,600 looks like
  every product crashed in price.
- **`source` is per observation**, not per run, so a fallback is legible row by row.
- **Sizes are stored decomposed**, matching the `priceRecordSchema` extension `HANDOFF.md`
  proposes, so shrinkflation is a `WHERE` clause and the eventual port is mechanical.

A near-total change rate on an established store now suppresses the write and opens a
`mass_change_suppressed` incident instead. That shape is far more likely to be a
`product_key` scheme change than every item repricing at once, and writing it would
overwrite the price history with noise.

## Correctness

`test_vet.py` covers the pure logic: robots matching, product-URL scoring, basket
matching, sitemap parsing, and page classification. Every test is a mistake this
harness actually made - a `/*/cart/` rule that excluded five good sites, recipe and
recall pages probed as products, a toy "surprise egg" mapped to the basket, a
banana-flavoured medicine mapped to bananas, a marketing banner scored as a product.

Two of those were still live when the tests were first written, which is the point.

TLS certificates are verified by default. A cert failure is recorded as `blocked`
rather than suppressed, since a broken cert is a real finding about a site. Pass
`--insecure` to skip verification; `tier0.json` records which mode produced it.

## A third: trusting a long-running process

A background pull loads its code once. Stores it reaches an hour later still run the
code as it was at launch. Landers, The Fresh Market and Wegmans were all pulled by a
process holding pre-fix code in memory, and their zero-row results were treated as
findings about the stores rather than artefacts of stale code.

If a fix lands mid-run, re-run the stores that were already past. `runs.jsonl` records
`generated_at` per store precisely so you can tell which those were.

## Two mistakes worth not repeating

Both hid good stores for days, and both were harness limits mistaken for facts about
the world.

**Judging a store by its sitemap.** Sitemap keyword coverage reads 0/10 for a store
whose catalogue is only reachable by query. Ever Supermarket scored 85/backup that way
and turned out to have the best basket coverage of any store here once tested through
its own Shopify search. Test every store through its search API before believing a
coverage number.

**Assuming no structured data means no prices.** Kesar Grocery publishes 11,987
products and not one line of JSON-LD. It looked unusable until `extract_bare_html`
read the price out of an element that says it is a price. It is now the US index
source, carrying real fresh produce.

The second one also overturned a conclusion stated confidently five times over - that
no US retailer publishes plain staples. That held for the segments actually tested
(supermarket chains, online pantries, snack importers) and not for US ethnic grocers,
which were never tested properly. The superseded finding is kept in
`manual-findings.json` rather than deleted.

## Known limits

- Probes run from a Manila IP, so a US tier-0 failure is not conclusive - that is
  what the tier-1 `--country us` re-test is for.
- Sites with no sitemap are discovered by crawling homepage -> categories ->
  products. Basket-relevant categories are visited first so the sampled URL pool
  stays roughly comparable to a sitemap-derived one, but it is still a smaller
  sample, so their category counts read low relative to sitemap sites.
- Basket mapping is URL-slug keyword matching with a non-grocery blocklist. It is
  a discovery aid, not a product catalogue: confirm items before wiring a scraper.
- Automated selection settles roughly half the items; the rest need curation.
  `manual-basket.json` holds hand-picked corrections and a `not_available` list for
  staples a store genuinely does not stock, so the index can tell a real gap from a
  scraper fault and nobody re-investigates the same dead end.
- The prebuilt-scraper check is a judgement call from a hand-maintained list, not
  a live query against Bright Data's library.
