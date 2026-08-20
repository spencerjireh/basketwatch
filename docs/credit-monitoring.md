---
title: Credit monitoring and spend caps
tags: [hackathon, brightdata, ops]
created: 2026-08-20
status: in-use
---

# Credit monitoring and spend caps

Credits are the one resource we cannot top up this week. Two accounts,
roughly $50 each, and the demo depends on having enough left on Sunday to
run a live heal in front of judges. This documents what Bright Data will
actually tell us about spend, what it will not, and the two guards we run
everything through as a result.

## What it already cost to learn this

Not hypothetical. Studio runs against listing pages spent **$26.54 against a
$5 ceiling** on Spencer's account on Aug 20 — about half the account, on an
assumption that turned out to be wrong (that Studio could be pointed at a bulk
JSON endpoint). The overrun is written up in `spencer-exploration/README.md`
and the collectors it paid for were abandoned; those stores are collected by
free HTTP instead.

Three lessons came out of it, and the guards below now encode all three:

1. **A ceiling that is not wired to a call site is not a ceiling.** The
   previous version was a `Budget` class nothing ever called.
2. **A timeout means still spending, not stopped.** Killing the local CLI
   leaves the collection running and billing server-side, so the meter must
   be re-read after a timeout exactly as after a success.
3. **Bound the collector, not just the submission.** A page limit cannot stop
   one page that crawls onward — that is how an early scraper pulled ~150
   pages and 4,470 rows. The crawl scope goes in the creation description.

Cost is not uniform, which is what made the overrun possible: a product-page
Studio run costs cents, a listing-page run cost about **$2.19**. Free HTTP
against a Shopify or Magento bulk endpoint returns 250 products for nothing.
By contrast the entire 433-call vetting sweep, which felt like the risky part,
cost **$0.52**.

## What the CLI can and cannot report

Tested against CLI 0.3.5 on Aug 20, on Edjin's account.

| Command | Reports | Use it for |
|---|---|---|
| `budget balance` | Balance and pending charge, rounded to the dollar | Nothing operational. It read $52.00 before and after six Unlocker calls |
| `budget zones` | Cost and bandwidth per zone, cost to the cent | Everything. `cli_unlocker $0.01 / 8.8 MB`, `cli_browser $0.00 / 0 B` |
| `budget zone <name>` | The same for a single zone | Attributing spend to Unlocker vs the browser tier |

Three findings that shape how we monitor:

1. **Balance is too coarse to see an action.** It moves in dollars while our
   actions cost fractions of a cent. Six Unlocker calls did not move it at
   all.
2. **Usage lags by minutes.** A scrape that had already returned its
   payload still was not reflected in `budget zones`; the cent landed on a
   later read. So the cost of any single action, measured immediately, is
   usually reported as $0.00 and shows up attributed to whatever ran next.
3. **Bandwidth moves before cost does.** Megabytes are visible while the
   dollars are still rounding, which makes bandwidth the leading indicator
   of the failure mode we have actually hit on this project: an unbounded
   scraper description that crawled roughly 150 pages.

## Two guards, and why both exist

There are two, one per language, written independently on the same day. They
are not redundant: they measure different things, and each is blind where the
other sees.

| | `spencer-exploration/studio.py` (`Guard`) | `scripts/bd.mjs` |
|---|---|---|
| Measures | account balance, before and after every call | per-zone cumulative cost **and bandwidth** |
| Granularity | dollars, rounded | cents, plus megabytes |
| Enforces | one ceiling, checked at every call site | per-action, per-hour, per-day, reserve floor |
| Blind to | anything under a dollar; it calls its own figure a floor, not a settled number | spend that never touches the CLI |
| Used by | the Python exploration and Studio pullers | the Node exploration, and the app path |

The balance-vs-zones split is the important part. Balance rounds to the dollar
and sat at $52.00 across six Unlocker calls, so it cannot see a single cheap
action — which is precisely the limitation the Python guard documents about
itself. Zone bandwidth moves immediately, which is why the Node guard leans on
megabytes as the leading indicator. Read together they bracket the truth: the
balance is the settled floor, the zone totals are the early signal.

Neither can see the other's account, which is the gap the protocol below
exists to close.

## Unified guard protocol

Both guards exist because we have two runtimes and two accounts. They are not
going to merge into one binary, but they must follow the same rules so that
the spend picture is coherent when we look at it together.

### Shared rules (both sides must follow)

1. **Same caps, from the same place.** The source of truth is `.env.example`
   at the repo root. Both guards must respect the same five values:
   `BD_MAX_PER_ACTION_USD`, `BD_MAX_PER_ACTION_MB`, `BD_MAX_PER_HOUR_USD`,
   `CREDIT_DAILY_CEILING_USD`, `BD_MIN_BALANCE_USD`. If you raise a cap,
   raise it in `.env.example`, say so in the PR, and make sure both guards
   pick it up.

   **Gap to close:** `bd.mjs` reads these from `.env` at the repo root.
   `studio.py`'s `Guard` takes `cap_usd` as a constructor argument,
   defaulting to 5.0 in the CLI flags (`--cap-usd 5.0`), and `bd_tier1.py`
   has its own `Budget` class with the same hardcoded default. Neither Python
   guard reads the env vars. Until they do, changing a cap in `.env` only
   changes one side. The fix is for the Python guards to fall back to the
   env vars when no explicit argument is given — a one-line change per call
   site, but it touches Spencer's code, so coordinate before patching.
2. **Preflight before every call.** Check balance and/or spend before the
   action, not just after. A post-hoc breach stops the loop but not the
   charge.
3. **Meter after every call, including timeouts.** Killing the CLI does not
   stop server-side billing. Both guards already do this; the rule is here so
   a future refactor does not drop it.
4. **Label every action.** The ledger row or log line must say what the action
   was for (`vet-us`, `heal-landers`, `catalogue-pull`), not just what
   command ran.
5. **Exit non-zero on a breach.** So a loop or script that chains actions
   halts instead of repeating an expensive mistake.

### Cross-boundary visibility

Neither guard can see the other's account spend. Until the `studio_calls`
table lands in Postgres (Phase 2), close the gap manually:

- **Before a credit-heavy session**, check the other account's balance. The
  command is free: `brightdata budget` (or `bd_tier1.py --budget-only`). If
  the other account is running low, coordinate before spending more on yours.
- **In every PR that spends credits**, paste the guard's report output and
  state which account was used. This is the only way the other person sees
  your spend before `studio_calls` exists.
- **At each phase checkpoint**, both people run their guard's report and post
  the numbers in the sync. The standing-numbers section at the bottom of this
  file gets updated from those reports.

### When the app takes over

The deployed heal orchestrator (Phase 3) runs on one account and enforces the
same caps in application code. At that point, the CLI guards become
development-only tools and the `studio_calls` table becomes the single
ledger. The caps still live in `.env.example` and the orchestrator reads
them from environment variables, so there is still one place to look.

## The Node guard

Nothing in this repo calls the Bright Data CLI directly for anything
that spends. It goes through `scripts/bd.mjs`, at the repo root. It has no
dependencies and needs no install -- run it from anywhere in the repo:

```sh
node scripts/bd.mjs --label=vet-us -- scrape https://example.com --country us
node scripts/bd.mjs --report
BD_DRY_RUN=1 node scripts/bd.mjs --label=whatever -- <args>   # preflight only
```

Around every action it reads the zone meter, runs the command, reads the
meter again, and appends a ledger row. Before the action it refuses to
proceed if a cap is already breached.

| Cap | Default | The failure it defends against |
|---|---|---|
| `BD_MAX_PER_ACTION_MB` | 50 MB | The unbounded crawl, caught in megabytes before it is visible in dollars |
| `BD_MAX_PER_ACTION_USD` | $0.25 | A single create or heal costing far more than the cents we assume |
| `BD_MAX_PER_HOUR_USD` | $1.00 | A retry loop, or a scheduler firing faster than intended |
| `CREDIT_DAILY_CEILING_USD` | $5.00 | A whole day's drift across every tool |
| `BD_MIN_BALANCE_USD` | $20.00 | Arriving at demo day without the credits to run the live heal |

Exit codes matter, because these run inside loops:

- **2** — refused before running. Nothing was spent.
- **3** — the action ran and then breached a per-action cap. Stop and look
  at the scraper's crawl scope before running anything else.
- **1** — the underlying CLI command failed.

A hung CLI is killed after `BD_CLI_TIMEOUT_MS` (10 minutes by default), and
the meter is read afterwards regardless, because the timeout bounds our wait
and not the spend. A timed-out action is charged against the caps like any
other.

Because of the reporting lag, the hourly and daily caps are **not** the sum
of our own per-action deltas. They measure the movement in Bright Data's
cumulative zone total since the first action in the window. That
self-corrects as lagging usage lands, and it also catches spend from
anything that bypassed the wrapper.

For scraper creation and heals, set `BD_SETTLE_MS=30000` so the wrapper
waits for the usage to land and the true cost surfaces before the next
action rather than three actions later.

## The ledger

One JSON line per action in `scratch/credit-ledger.jsonl` at the repo root:
timestamp, label, command, ok, duration, cost and bandwidth delta, per-zone
breakdown, cumulative totals either side, and the balance after.

`--report` groups it by label and prints spend per action type, the day's
total against the ceiling, Bright Data's own cumulative figure, and any
unattributed difference between the two. Unattributed spend is normal in
small amounts — it is the lag — but a large gap means something spent
credits outside the wrapper.

`scratch/` is gitignored and per-machine, so this ledger is Edjin's local
record only. The durable version is the `studio_calls` table planned in
Phase 2 (timestamp, operation, collector, balance before and after, prompt,
outcome), which the API writes for every Studio call including autonomous
heals. Until that lands, quote the ledger in PR descriptions rather than
assuming the other person can see it.

## Limits, and what still needs watching by hand

- **One account at a time.** The guard sees whichever account the CLI is
  authenticated as. Spencer's spend is invisible here and vice versa, which
  is the other reason every collector records its owning account.
- **CLI-initiated spend only.** Scheduled runs from the deployed
  orchestrator and webhook-driven collection also cost credits and do not
  pass through this wrapper. The heal orchestrator enforces the same caps
  in code (Phase 3); scheduled fleet runs are bounded by the schedule
  itself, so keep the schedule conservative.
- **Caps are advisory to Bright Data, binding only on us.** Nothing here
  can stop a runaway on their side. It stops *our next action*, which is
  why the per-action bandwidth cap matters more than the dollar caps.
- Raise a cap deliberately in `.env` when a step genuinely needs it, and
  say so in the PR. Never edit it silently to make a command go through.

## Standing numbers

As of Aug 20:

- **Edjin's account.** Balance $52.00, no pending charge, $0.02 total across
  all zones for 8.8 MB — six Unlocker calls during site vetting plus one test
  of the guard. Effectively untouched.
- **Spencer's account.** Opened the week at $49.55. The vetting sweep took
  $0.52 across 433 calls; the abandoned listing-page Studio work took $26.54.
  That account carries all the Studio collectors.

The asymmetry is now the main budget fact: one account holds the collectors
and has spent roughly half its credits, the other is nearly full but owns
nothing. It feeds directly into the open decision in
[index](index.md) about which account owns the fleet, because triggers and
heals cannot cross accounts and demo day needs whichever account runs the
live heal to still be funded.

The `cli_browser` zone is unused at $0.00 on Edjin's side, and it is the one
to watch when the geo-targeted browser tier gets used, since browser sessions
bill by bandwidth and hold a session open.
