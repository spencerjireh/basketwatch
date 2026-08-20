# edjin-exploration

Browser-based site vetting, and the evidence behind
[docs/site-vetting.md](../docs/site-vetting.md).

This is the counterpart to `spencer-exploration/`, and it exists for the same
reason: exploration produces a lot of throwaway scripts and a little durable
evidence, and mixing either into the product tree is how the product tree
rots. Nothing here is imported by `scrape-verse/`, and its one dependency,
`playwright-core`, is installed here rather than in the product workspace.

The one exception is deliberate: the credit guard lives at
`scrape-verse/scripts/bd.mjs`, not here, because `AGENTS.md` mandates it for
every Bright Data call anywhere in the repo and the heal orchestrator will
enforce the same caps in Phase 3. It is tooling, not exploration.

## Why a second vetting pass exists

`spencer-exploration/registry.json` vetted 163 candidates over HTTP and the
Web Unlocker. Neither executes JavaScript. That is fine for most sites and
wrong for the ones that matter most: an HTTP-only pass rejected Landers on a
10kb empty shell, and in a real browser Landers is the best-covered PH grocery
site on the board.

So this pass renders. It answers exactly one question the registry cannot —
what is actually on the page — and it is deliberately narrow: 19 candidates,
not 163. Where the two passes agree, that is independent confirmation. Where
they disagree, `docs/site-vetting.md` states the disagreement and proposes the
registry edit rather than making it. The registry stays the source of truth
for the fleet; `fleet.lock.json` stays the decision.

The headline correction: **Weee!** is `reject`/score 15 in the registry, as
`blocked via none`, meaning no collector ever got in. A headed browser got in
on the first try and measured 10/10 basket staples with prices in static HTML.

## Layout

| Path | What it is |
|---|---|
| `vet.mjs` | The funnel. Tier 0 is robots.txt plus the declared sitemap over free HTTP; tier 1 renders the homepage, a category page and sample product pages in Chrome |
| `vet.json` | Every probe's raw result, committed. This is the evidence — verdicts are derived from it and can be recomputed without touching the network |
| `vet-seed.md` | Per-site staple URLs with titles and prices, the seed rows for `products` |
| `probes/` | Single-purpose throwaways kept because they are quicker to re-read than rewrite: `probe.mjs` (structure of one URL), `debug-links.mjs` (why a coverage count was zero), `analyze-html.mjs` (parse a saved Unlocker response) |
| `raw/` | Saved Unlocker HTML. Gitignored: megabytes of site content we do not own |

## Running it

```sh
npm install                    # playwright-core only; uses your installed Chrome
node vet.mjs                   # full pass, about four minutes
node vet.mjs --only=Landers    # one site
node vet.mjs --tier0-only      # robots and sitemap, no browser
node vet.mjs --rescore         # recompute verdicts from vet.json, no network
```

A partial run merges into `vet.json` rather than overwriting it, so
`--only` never destroys the rest of the evidence.

The browser runs **headed** by default. Headless tripped a Cloudflare
challenge on Landers that a headed window did not, and a false BLOCKED is the
most expensive kind of wrong verdict here — it is what nearly lost us the best
PH site. `--headless` opts back in.

## Reading the results honestly

Three things will mislead a reader who trusts the verdict column:

1. **`NOT RUN` means exactly that.** Twenty round-2 candidates got a tier-0
   probe and never got the browser pass, because Spencer's registry turned out
   to already cover them. They are kept for their robots and sitemap data.
   Earlier these were scored `UNREACHABLE`, which was a verdict the run never
   earned; the rescore now distinguishes the two.
2. **Coverage is a keyword match over product titles, so it over-reports.**
   Southstar's "rice" is Johnson's baby lotion and Watsons' "sugar" is a lip
   balm. A staple only counts when the title also carries a unit token, which
   filters most of it, but read the sample titles in `vet-seed.md` before
   trusting a count.
3. **Every US verdict here was taken from a PH IP.** A US site that looks
   blocked may only be geo-gated. That question needs
   `brightdata browser --country us`, which costs credits and has not been
   run — the US findings in the registry are better evidence than these.

Where this pass got things wrong is recorded in `docs/site-vetting.md` rather
than quietly fixed: S&R was marked UNREACHABLE on a navigation failure the
registry did not hit, and two sites returned bot walls on one run and answered
normally an hour later.
