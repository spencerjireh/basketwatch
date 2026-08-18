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
| `candidates.json` | the seed list - hand-authored, expanded by SERP discovery |
| `vet.py` | tier 0: free HTTP probes, robots, sitemaps, basket mapping, classification |
| `bd_tier1.py` | tier 1: Web Unlocker sweep over what tier 0 could not settle, with a hard credit ceiling |
| `score.py` | merges both tiers into the scored registry |
| `registry.json` | **the deliverable** - every candidate, scored, with evidence |
| `registry.md` | human scorecard, PH gate verdict, recommended fleet |
| `tier0.json` / `tier1.json` | raw evidence behind the registry |
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

# score and build the registry
uv run spencer-exploration/score.py
```

`bd_tier1.py` reads the live account balance before it starts and re-checks it as
it goes; it stops the sweep the moment spend reaches `--cap-usd`. Between balance
reads it also tracks a deliberately pessimistic per-call estimate, so a burst
cannot overshoot the ceiling in the gap.

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

## Known limits

- Probes run from a Manila IP, so a US tier-0 failure is not conclusive - that is
  what the tier-1 `--country us` re-test is for.
- Basket mapping is URL-slug keyword matching with a non-grocery blocklist. It is
  a discovery aid, not a product catalogue: confirm items before wiring a scraper.
- The prebuilt-scraper check is a judgement call from a hand-maintained list, not
  a live query against Bright Data's library.
