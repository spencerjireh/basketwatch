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
| `catalogue.py` | **the puller** - every product a store sells, priced; the primary path for the 11 bulk-endpoint stores and the labelled fallback everywhere else |
| `store.py` | **the SQLite store** - schema, migration, queries, JSON export |
| `catalogue.db` | **the catalogue** - stores, products, change-only price history, runs, incidents |
| `catalogue/` | per-store JSON, regenerated on demand by `--export-json` (gitignored); `runs.jsonl` and `changes.jsonl` are the pre-SQLite record and stay tracked |
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
| `tier0*.json` / `tier1*.json` | raw evidence behind the registry, one pair per discovery round |
| `manual-findings.json` | hand-verified findings and incidents, including the ones that overturned earlier conclusions |
| `test_vet.py` | tests for the pure vetting logic - every case is a bug this harness shipped |
| `test_basket.py` | tests for size parsing, unit-price maths and staple matching |
| `test_catalogue.py` | tests for the page ceiling and change detection |
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

# tests - the whole suite, 172 of them
uv run --with pytest --with 'httpx[http2]' pytest spencer-exploration/ -q
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
unit-priced. 28,376 products across 17 stores, 24,100 with a unit price, two days of
history and 30 recorded price moves.
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
repo's own validator, not by eye. These are the **original single-product proof
collectors** from 2026-08-18, kept as the evidence they were; the live fleet collectors
are recorded separately in `studio-collectors.json` and are different ids:

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

## Which transport collects which store, and why

Not a preference. The fleet divides by what each site actually permits.

| group | stores | over plain HTTP | what Studio adds |
|---|---|---|---|
| **Bulk endpoint** (11) | shopgaisano, ever, shopsuki, smmarkets, mexgrocer, cypressindian, latimex, mexmax, amigofoods, lilimart, sukli | 250 products per call, complete catalogues, free | nothing - and it costs ~$2.19 a run to add nothing |
| **Page at a time** (4) | kesargrocery, dierbergs, merrymartwholesale, hmart | works, one fetch per product page | a peer alternative at similar shape, plus browser resilience and a heal path when the page changes |
| **Browser only** (1) | landers | **zero rows** from 300 pages, no price in the HTML even through the Web Unlocker | the only way in at all |

This was not the first arrangement. For part of 2026-08-20, Studio was made the primary
collector for the *whole* fleet, on the reasoning that a project judged on Scraper Studio
should not route its data around it. Verifying that arrangement cost **$26.54 against a
$5 ceiling**, and the table above is what the evidence left standing.

The honest summary is narrower than the earlier claim and worth stating plainly: **one
store genuinely requires a browser.** Four more are reasonable Studio targets because
they are page-at-a-time anyway. Eleven publish an API, and paying a cloud browser to
re-read a free JSON endpoint is strictly worse on cost, on row count and on latency.

Six collectors are verified against real products (`smmarkets`, `merrymartwholesale`,
`kesargrocery`, `dierbergs`, `hmart` ready; `landers` partial). SM Markets is among them
and is still collected over HTTP, because its GraphQL endpoint returns 1,688 rows for
nothing - a proven collector we do not need to spend on.

`catalogue.py` keeps everything it is good at either way: discovery, page ceilings, size
parsing, unit pricing, dedup, change detection. Only the fetch moves. Studio is handed a
bounded URL list and returns structured rows, and the bound is applied before the
subprocess spawns, because that is where the money is.

When a Studio collector fails, the puller covers, and the substitution is recorded
rather than hidden: `price_observations.source` reads `puller`, the run row says so, and
a `studio_failed` incident opens. The series stays unbroken and nothing is silent.

### The pilot: born broken, then healed, then only partly

ph-landers was the pilot precisely because it is the one store with no alternative, so
anything it produces is attributable to Studio and nothing else.

The generated collector shipped broken: the site hostname as the product name, no price,
`in_stock: false` for everything, and no error raised. One
`scraper heal --auto-approve --auto-save` fixed it, and the same five URLs then returned

    Baguio Canola Oil 1.5L        PHP 228.00   PHP 152.00 / litre
    Baguio Pure Coconut Oil 1.8L  PHP 385.50   PHP 214.17 / litre

**It is recorded as `partial`, not healed.** A later batch over a different section of
the same site returned mostly hostname rows again - a render race rather than a selector
fault. A second heal, which ran `css_selector_extractor`, stopped the garbage rows but
left the yield at roughly 1 usable row in 10 on `/food-cupboard/` against 4 in 5 on
`/anti-hoarding-and-anti-panic-buying-list/`. Two heals is the budget per store.

Self-healing fixed a broken extractor outright and did not fix a hostile render race.
Both halves are true and the second one is the more useful to record.

### Three things the pilot found that planning did not

- A product-page collector emits no `url` field, because the page it was handed *is* the
  product. The URL exists only on the echoed trigger payload, which was being stripped
  as non-data. Every row was silently dropped.
- Prices arrive as whatever the page showed: `"PHP 389.50"`, `"1,234.00"`,
  `"Price on request"`. A price that will not coerce drops the row.
- The collector returned size `"1G"` for a product titled `"1Gal."`. That parses cleanly
  as one gram and priced the oil at PHP 799,950 per kilo. Conflicting sizes now emit no
  unit price at all - a missing one is a visible gap, a wrong one poisons every
  comparison the product exists to make.

### Three CLI facts worth knowing before scripting against it

All verified in the CLI's own source rather than its `--help`, and all wrong in the
obvious reading:

- **`--timeout` is an attempt count, not seconds.** `polling.js` loops
  `attempt < timeout_seconds` and the batch poll interval is 10,000 ms, so the batch
  default of `3600` polls for **ten hours**. Pass an explicit count, wrap it in a
  deadline.
- **Killing the CLI does not stop the remote job.** `proc.kill()` ends the local client;
  the collection is already triggered server-side and Bright Data keeps rendering and
  billing it. A timeout means *still spending*.
- **There is no `scraper list`.** `studio-collectors.json` is the only
  store-to-collector mapping in existence, which is why creation writes the id *before*
  verification, why abandoned collectors keep their ids, and why `.gitignore`'s
  `studio-*.json` needed an explicit negation - that pattern is the most plausible reason
  the first three collectors' descriptions were lost.

### Studio cannot build a collector for a JSON endpoint

Tested, because it had been asserted at planning time and never checked. A collector
against `ever.ph/products.json?limit=250&page=1`, with a description naming the
`products` array and the exact fields to read, ran AI generation for 17 minutes and
never completed; the sixteen page-based collectors each finished in 35 seconds to five
minutes. Cost `$0` - generation is free.

The likely reason is structural: the pipeline runs `user_intent_analyzer ->
output_schema_generator -> code_generator -> preview_runner -> preview_picker`, and a
raw JSON document gives the preview stages nothing to pick from.

So the assumption was right. It had also been driving spending decisions for a day while
it was still a guess, and the check cost nothing.

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

## Mistakes worth not repeating

Every one of these was a harness limit or an untested assumption mistaken for a fact
about the world. The last three cost money.

**Judging a store by its sitemap.** Sitemap keyword coverage reads 0/10 for a store
whose catalogue is only reachable by query. Ever Supermarket scored 85/backup that way
and turned out to have the best basket coverage of any store here once tested through
its own Shopify search. The same measure fails in the other direction: Kalustyan's
scored 100 with a 10/10 basket on the strength of URLs like
`/products/rice-cooker-drc-230automatic`, and measured 0/10 against real product titles.
It was rejected rather than locked. Test a store through its search API before believing
a coverage number.

**Assuming no structured data means no prices.** Kesar Grocery publishes 11,987 products
and not one line of JSON-LD. It looked unusable until `extract_bare_html` read the price
out of an element that says it is a price. It became the first US index source. That
also overturned a conclusion stated confidently five times - that no US retailer
publishes plain staples. It held for the segments actually tested (supermarket chains,
online pantries, snack importers) and not for US ethnic grocers, which were never tested
properly. The superseded finding is kept in `manual-findings.json` rather than deleted.

**Trusting a long-running process.** A background pull loads its code once. Stores it
reaches an hour later still run the code as it was at launch. Landers, The Fresh Market
and Wegmans were all pulled by a process holding pre-fix code in memory, and their
zero-row results were treated as findings about the stores rather than artefacts of
stale code. If a fix lands mid-run, re-run the stores that were already past - `runs`
records a timestamp per store precisely so you can tell which those were.

**A guard nothing calls is not a guard.** `bd_tier1.py` has a `Budget` class with a
ceiling, a spend estimate and a trip flag. The Studio path never called it. Sixteen
verification runs went out with nothing between the loop and the account, and spent
**$26.54 against a $5 ceiling**. The guard now lives in `studio.py` as `Guard`, its
`check()` is pure so it is tested directly, and every call site runs `preflight()`
first.

**Killing the CLI does not stop the remote job.** Every Studio call is wrapped in
`asyncio.wait_for` with a `proc.kill()` on expiry - added deliberately, because the
CLI's batch default polls for ten hours. But `kill()` ends the *local client*. The
collection is already triggered server-side and Bright Data keeps rendering and billing
it. Ten canaries printed `FAILED ... exceeded 110s` and every one of them kept spending
after that line. The safeguard concealed the spend rather than stopping it. A timeout is
now re-charged against the ceiling like any other call.

**An untested assumption spent $26.54.** "Pointing Studio at a bulk JSON endpoint is a
category error" was written into a plan and never checked. It is what pushed ten stores
onto the listing-page template - rendering a full collection grid in a cloud browser to
extract products those stores already publish for free. When finally tested the
assumption was *correct*. It was also free to test and took one command. Being right is
not the same as having checked, and the difference here was a day of spending decisions.

**Reading "wholesaler" as a feature.** MexMax was locked as a US index contributor on
measured item coverage - 8/10, the best of the candidates - and its own description says
*wholesaler*. That was read as a sign of catalogue depth and never checked against price
comparability. Its listed price is a case price against a unit size in the title:
"Goya Thai Jasmine Rice - 5 lb" at $125.03. MerryMart Wholesale has the same shape and
had been in the fleet longer. The case count appears in about 1% of their product
titles, so a correct unit price is not computable for the rest at any effort.

Both now carry `pricing: "wholesale"`, keep their prices, and publish no unit price. They
stay in the tracker because a case price moving is a real signal; they leave the index
because a case price is not a shelf price. The claim that MexMax "fixes the US gaps that
mattered - eggs, chicken, cooking oil" was wrong as stated: the items are there, the
prices are not comparable.

**Letting the wrong answers set the baseline.** The unit-price outlier check compares a
pick against the median for the same item across stores. With two wholesalers in the
pool, the median rose and *correct* rows started failing: a $2.42/kg baking potato at
Kesar was flagged as 0.17x an average set by potato gnocchi and dried Peruvian potato.
Of 21 flagged outliers, 18 were this. Excluding wholesale from the baseline and raising
the peer floor from three stores to four took the flags to zero - and each of the three
real ones then had a cause: one matcher bug, and two stores that genuinely do not stock
the staple.

## Known limits

- **Two days of history.** The mechanism is proven - 30 real price moves recorded with
  their deltas - but a tracker is its history, and this is the one thing that cannot be
  backfilled. Every day without a run is a permanent gap.
- **The listing-page Studio template is dead.** All ten canaries timed out and the ten
  runs cost $26.54. The stores it targeted are collected by free HTTP instead. Their
  collectors are marked `abandoned` in `studio-collectors.json` with their ids kept,
  because the CLI cannot list collectors and a discarded id is unrecoverable.
- **Studio cannot target a JSON endpoint**, so there is no cheap way for it to collect a
  store that publishes a bulk API. Tested, 17 minutes, never converged, $0.
- **ph-landers is `partial`, not solved.** Roughly one usable row per ten URLs on
  `/food-cupboard/` after two heals. Still the only access path that store has.
- **A Studio timeout is not a stop.** Bright Data keeps rendering and billing after the
  local CLI is killed, so a run that appears to have failed may still be spending.
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
