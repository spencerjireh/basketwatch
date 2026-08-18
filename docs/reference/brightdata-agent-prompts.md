---
title: Bright Data Scraper Studio — coding agent prompts
tags: [hackathon, brightdata, reference, vendored]
created: 2026-08-18
---

> [!info] Vendored reference — not our work
> Verbatim copy of `README.md` from
> [anil-bd/scraper-studio-scrape-verse-hackathon-august-2026](https://github.com/anil-bd/scraper-studio-scrape-verse-hackathon-august-2026)
> (Bright Data's official demo repo for this hackathon), commit `857dbf1`,
> fetched 2026-08-18. Do not edit — re-fetch to update.
> Companion: [[brightdata-demo-ideas]].

---

**Demo repo for [Into the Scrape-Verse](https://www.wemakedevs.org/hackathons/scrape-verse), the WeMakeDevs hackathon sponsored by Bright Data. 17 to 23 August 2026, online from anywhere or in person in San Francisco, solo or in teams of up to four.**

Everything below is a set of copy-pasteable prompts that build, run and self-heal a Bright Data scraper with a coding agent. Run them verbatim against the demo store first, then point the same prompts at the target you picked for your project.

Still picking a project? [Three ideas to demo](brightdata-demo-ideas.md), each chosen so Scraper Studio is unavoidable and the self-heal is real rather than staged.

**Before you build**

- Sign up free at [brightdata.com](https://brightdata.com/?hs_signup=1&utm_source=docs). No card required, 5,000 credits a month on the free tier.
- Apply the promo code `wemakedevs`, lowercase, for the extra $50 in hackathon credits.
- Pick a target that is not already in Bright Data's pre-built scraper library. Step 0 below shows you how to check.
- Scrape public data only. No login-protected pages, no paywalled content, no personal data.
- Keep your API token and your `.env` out of your repo and out of your demo video.

**What the judges are looking for**

- At least one working create-and-run flow, with the Collector ID as proof.
- A self-healing demonstration wherever the target allows one.
- The Collector ID wired into something downstream: an API, a database, a schedule, a dashboard.
- A repo with reproducible setup instructions, and an explanation of the code your agent generated.

Full rules, prizes, credits and the submission form: [wemakedevs.org/hackathons/scrape-verse](https://www.wemakedevs.org/hackathons/scrape-verse)

---

# Bright Data Scraper Studio: Coding Agent Prompts

Copy-pasteable prompts for building a [Bright Data Scraper Studio](https://docs.brightdata.com/datasets/scraper-studio/coding-agent-prompts) scraper with a coding agent (Claude Code, Cursor, or Codex).

The flow is deliberate and simple:

1. **Check the library first**: see if Bright Data already ships a ready-made scraper for your target before you build anything.
2. **Build a scraper in one prompt**: if there's no pre-built option, paste a single prompt and the agent builds and runs it.
3. **Build, run, heal, verify**: the full self-heal loop for extending a scraper's schema in place.
4. **Run it step by step**: work through the same loop one prompt at a time when you want to inspect each result.

---

## The challenge

Scraping a website by hand is fragile work. You write CSS selectors, the site ships a redesign, your selectors break, and you're back to inspecting the DOM. Extending a scraper to grab one more field means another round of manual parsing. Most of that effort is wasted twice over, first because a ready-made scraper for popular sites probably already exists, and second because a coding agent can write, run, and self-heal the scraper for you.

This guide solves both: **check the library before you build**, then let your coding agent (Claude Code, Cursor, or Codex) drive the Bright Data CLI through the full build → run → heal → verify loop.

Every example below targets the public demo store **[shopalto.xyz](https://shopalto.xyz/)**: specifically the product page `https://shopalto.xyz/product/aurora-wireless-headphones`, so you can run each prompt verbatim and compare your output against the expected result.

---

## Prerequisites

- A Bright Data account ([sign up free](https://brightdata.com/?hs_signup=1&utm_source=docs), no card required).
- A coding agent with terminal access: Claude Code, Cursor, or Codex.

You do **not** install the Bright Data CLI ahead of time. The prompts run it through `npx`, which fetches the latest version on demand, no global dependency to maintain.

Every prompt below authenticates with `bdata login --device`. The device flow prints a code and a URL, you confirm it in your browser, and the CLI picks up the session. Use it instead of the plain `bdata login` browser callback, which does not complete reliably when the CLI is running inside a coding agent, a remote shell or an SSH session. If you prefer to skip the browser entirely, [generate an API token](https://brightdata.com/cp/setting) and run `npx -p @brightdata/cli bdata login --api-key <YOUR_TOKEN>` instead.

---

## Step 0: Check the Bright Data Scraper library first

> **Challenge:** Don't build what already exists. Most popular sites already have a maintained, ready-made scraper.

Before building a custom scraper, check whether Bright Data already has one for your target site. A ready-made scraper saves you the build entirely.

**Browse the library here:** **https://brightdata.com/cp/scrapers/browse**

1. Open the [Scraper library](https://brightdata.com/cp/scrapers/browse).
2. Search for your target site or domain (e.g. `amazon`, `linkedin`, `instagram`, `shopify`).
3. If a matching scraper exists, use it directly, no build needed.
4. If nothing matches, continue to **Step 1** and build your own with a coding agent.

> **Tip:** The library covers most major sites. Building a custom scraper is for the long tail, pages with no ready-made collector.

---

## Step 1: Build a scraper in one prompt

> **Challenge:** You need a working scraper fast and don't want to hand-write or maintain selectors.

No match in the library? Paste this prompt and replace the two values in angle brackets: the target URL and the fields you want. The agent runs the Bright Data CLI through `npx`, builds the scraper, and runs it once. No self-healing.

```text
Build and run a Bright Data scraper. Run every Bright Data CLI command through `npx -p @brightdata/cli` so nothing is installed globally. Replace <TARGET_URL> and <FIELDS TO EXTRACT>, then do each step in order and stop if a step fails:

1. Authenticate by running `npx -p @brightdata/cli bdata login --device`, then confirm the code in the browser when the CLI prints it. npx fetches the CLI on demand, so there is nothing to install.
2. Create a Bright Data scraper for <TARGET_URL> that extracts: <FIELDS TO EXTRACT>. Report the Collector ID.
3. Run that scraper on the same URL and pretty-print the result.
```

For example, the filled-in second step for a product page reads:

```text
2. Create a Bright Data scraper for https://shopalto.xyz/product/aurora-wireless-headphones that extracts: product name, price, description and rating. Report the Collector ID.
```

> **Expected result:** the agent reports a Collector ID like `c_mpohus372o5tmid1jk`, then prints a JSON array with one row containing the fields you asked for.

> **Save the Collector ID.** Reuse it to run the scraper on new URLs, or to extend its schema later with the self-heal flow below.

---

## Step 2: Build, run, and self-heal in one prompt

> **Challenge:** Your scraper works today, but the site changes, or you need to add fields without breaking the existing schema.

To run the full build → run → heal → approve → re-run loop, paste this single prompt and let the agent work through every step. The pattern is deliberate: build a minimal scraper first, then heal it to extend the schema, so the heal envelope's `preview_result` is easier to verify against a known-good baseline.

```text
Build, run, heal and verify a Bright Data scraper end to end. Run every Bright Data CLI command through `npx -p @brightdata/cli` so nothing is installed globally. Do every step in order and stop if a step fails:

1. Authenticate by running `npx -p @brightdata/cli bdata login --device`, then confirm the code in the browser when the CLI prints it. npx fetches the CLI on demand, so there is nothing to install.
2. Create a Bright Data scraper for https://shopalto.xyz/product/aurora-wireless-headphones that extracts two fields: product name and price. Report the Collector ID.
3. Run that scraper on the same URL and pretty-print the result. Expect one row with name and price.
4. Heal the scraper in place to also capture description, image url and rating alongside the existing name and price. Keep the same Collector ID, anchor the heal on the same URL and show the approval envelope.
5. When the preview shows all five fields, approve the fix anchored on the same URL.
6. Run the scraper on the same URL again and confirm all five fields come back: name, price, description, image_url and rating.
```

> **Expected result:** the agent ends with a JSON row containing `name`, `price`, `description`, `image_url`, and `rating`, and the Collector ID is unchanged from step 2.

---

## Step 3: Run the flow step by step

> **Challenge:** When the one-shot loop is too opaque, you want to inspect every Collector ID, run result, and heal envelope before moving on.

Work through the prompts below one at a time when you want to inspect each Collector ID, run result, and heal envelope before moving on.

### 3.1: Authenticate the CLI

```text
Run every Bright Data CLI command through `npx -p @brightdata/cli` so nothing is installed globally. Authenticate by running `npx -p @brightdata/cli bdata login --device` and confirm the code in the browser when the CLI prints it, then confirm the version with `npx -p @brightdata/cli bdata --version` before continuing.
```

> **Expected result:** the agent prints a `bdata` version and confirms it is authenticated.

### 3.2: Build a minimal scraper

```text
Create a Bright Data scraper for https://shopalto.xyz/product/aurora-wireless-headphones that extracts just two fields: product name and price. Show me the Collector ID when it is done.
```

> **Expected result:** the agent reports a Collector ID like `c_mpohus372o5tmid1jk`. Hold onto it; the rest of the prompts reuse the same ID.

### 3.3: Run it

```text
Run that scraper on https://shopalto.xyz/product/aurora-wireless-headphones and pretty-print the result.
```

> **Expected result:** a JSON array with one row, populated with `name` and `price` only.

### 3.4: Heal and add more fields

```text
Extend the scraper in place. Heal it to also capture description, image url and rating alongside the existing name and price. Keep the same Collector ID. Anchor the heal on https://shopalto.xyz/product/aurora-wireless-headphones and show me the approval envelope when it is ready.
```

> **Expected result:** the agent reports `status: "awaiting_approval"` with a `preview_result` row that now shows five fields.

### 3.5: Approve the fix

```text
The preview looks good. Approve the fix, anchored on https://shopalto.xyz/product/aurora-wireless-headphones.
```

> **Expected result:** `status` advances to `done`. The Collector ID is unchanged.

### 3.6: Verify the expanded schema

```text
Run the scraper on https://shopalto.xyz/product/aurora-wireless-headphones again and confirm all five fields now come back: name, price, description, image_url and rating.
```

> **Expected result:** the same JSON shape as the earlier run, now with three additional fields per row.

> **Unattended variant:** ask the agent to add `--auto-approve` to the heal call. The agent skips the approval gate and polls through to `done` in one step. Use it only when you trust the heal without a manual review.

---

## Step 4: Run one scraper across many URLs

> **Challenge:** One product page is a demo. Real work means running the same scraper across a whole catalog and getting one clean row per URL.

Once a scraper works for a single page, reuse the **same Collector ID** to run it across a batch of URLs in one go. Paste this prompt, keep your Collector ID, and let the agent fan out across all ten product pages below.

```text
Run an existing Bright Data scraper across multiple URLs in one batch. Run every Bright Data CLI command through `npx -p @brightdata/cli` so nothing is installed globally. Replace <COLLECTOR_ID> with the Collector ID from the build step, then do each step in order and stop if a step fails:

1. Authenticate by running `npx -p @brightdata/cli bdata login --device`, then confirm the code in the browser when the CLI prints it. npx fetches the CLI on demand, so there is nothing to install.
2. Run collector <COLLECTOR_ID> against all of the following URLs in a single batch run:
   https://shopalto.xyz/product/pulse-smartwatch
   https://shopalto.xyz/product/clack-75-mechanical-keyboard
   https://shopalto.xyz/product/mute-pro-earbuds
   https://shopalto.xyz/product/hub-9-usb-c-dock
   https://shopalto.xyz/product/quiet-fleece-hoodie
   https://shopalto.xyz/product/field-denim-jacket
   https://shopalto.xyz/product/everyday-cotton-tee
   https://shopalto.xyz/product/lane-canvas-sneakers
   https://shopalto.xyz/product/dugout-baseball-cap
   https://shopalto.xyz/product/highland-wool-scarf
3. Wait for the run to finish, then pretty-print the result as a JSON array with one row per URL.
4. Confirm you got ten rows back and report any URL that returned empty or errored.
```

> **Expected result:** a JSON array of ten rows, one per product, each carrying the same fields your scraper extracts (e.g. name, price, description, image_url, rating). Any URL that failed is called out separately so you can re-run just those.

> **Tip:** Save the ten URLs in a text file (one per line) and tell the agent to read the file instead of pasting them inline. This scales the same prompt from ten URLs to thousands.

---

## Related docs

- [Scraper library (browse)](https://brightdata.com/cp/scrapers/browse): check for a ready-made scraper first
- [Coding agent prompts](https://docs.brightdata.com/datasets/scraper-studio/coding-agent-prompts): source for the prompts above
- [Build with the Bright Data CLI](https://docs.brightdata.com/datasets/scraper-studio/build-with-the-cli): install, log in, create, run, heal
- [Self-Healing tool](https://docs.brightdata.com/datasets/scraper-studio/self-healing-tool): fix a scraper from the control panel
- [Scraper Studio API quickstart](https://docs.brightdata.com/datasets/scraper-studio/quickstart): trigger an existing scraper from cURL, Python, or Node.js
- [Bright Data CLI commands](https://docs.brightdata.com/cli/commands): flag reference for create, heal, and approve
