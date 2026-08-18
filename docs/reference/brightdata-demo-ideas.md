---
title: Bright Data — three demo ideas and target-selection gates
tags: [hackathon, brightdata, reference, vendored]
created: 2026-08-18
---

> [!info] Vendored reference — not our work
> Verbatim copy of `DEMO-IDEAS.md` from
> [anil-bd/scraper-studio-scrape-verse-hackathon-august-2026](https://github.com/anil-bd/scraper-studio-scrape-verse-hackathon-august-2026)
> (Bright Data's official demo repo for this hackathon), commit `857dbf1`,
> fetched 2026-08-18. Do not edit — re-fetch to update.
> Companion: [[brightdata-agent-prompts]].

---

# Three ideas to demo

Starter projects for [Into the Scrape-Verse](https://www.wemakedevs.org/hackathons/scrape-verse). None of these is required, and you will not lose points for ignoring all three. They exist because the hardest part of a seven-day hackathon is picking a target on day one, and a bad target costs you three days.

Each one is picked to satisfy the same four gates:

1. **Scraper Studio is unavoidable.** The target is long tail, so no pre-built scraper covers it. Confirm yours at the [Scraper library](https://brightdata.com/cp/scrapers/browse) before you build.
2. **Self-healing is load bearing.** There is a real moment where the scraper has to heal, not a staged one.
3. **Seven days, one to four people**, assuming you have never used Bright Data and lose a day to setup.
4. **The demo lands in 90 seconds.** A judge sees a screen, not a JSON blob.

The prompts in the [README](brightdata-agent-prompts.md) build every one of these. Start at Step 0, then Step 2 for the full build, run, heal and verify loop.

---

## 1. Stagelight

**Track:** Suit-Up (best UI)
**For:** people tired of hearing about the show the morning after it happened.
**What it gives them:** tonight's independent gigs in one city, on one map.

**Targets.** Twenty independent music venue calendar pages in a single city. Every venue rolls its own site, so you get twenty layouts for one schema.

**Why it forces Scraper Studio.** Bandsintown and Songkick miss small venues, and neither is in Bright Data's pre-built library. There is no maintained extractor for "the calendar page of a 200-capacity room."

**The self-heal beat.** Build against five venues that use plain HTML tables. Venue eleven runs a JavaScript calendar widget and returns nulls. Heal in place on the same Collector ID, show the approval envelope, and watch the preview fill in. Do not rewrite the scraper.

**Downstream and demo.** Nightly schedule to Postgres or Supabase, then a map UI with date and genre filters. On stage: pick Friday, pins appear, click one, land on the ticket page. This is the UI track, so spend your last day on the map, not the parser.

**Watch out for.** Venue sites go down. Build for partial failure and report which venues returned nothing, rather than showing an empty map.

---

## 2. OpenCall

**Track:** Web-Slinger (best use of Bright Data)
**For:** grad students, artists, indie researchers and anyone chasing funding without a grants office.
**What it gives them:** every open deadline that actually fits them, in one place.

**Targets.** Foundation grant pages, university research office calls, conference call-for-papers pages, artist residency listings. Four different institution types, all publishing deadlines on one-off pages.

**Why it forces Scraper Studio.** Deadlines live on hundreds of bespoke institutional pages. Nothing in the pre-built library touches them, and no two universities structure a funding call the same way.

**The self-heal beat.** Start minimal: title and deadline only. Run it, confirm two clean fields, then heal the same collector to add eligibility, award amount, and application link. Five fields across four institution types, one Collector ID that never changes. This is the exact flow in Step 2 of the README.

**Downstream and demo.** Weekly schedule, then LLM matching against a pasted profile, then a digest email. On stage: paste a two-line bio, get five ranked deadlines with the source page next to each one.

**Watch out for.** Some funding portals sit behind a login. Those are out of scope for the hackathon and unsupported by Scraper Studio. Public listing pages only.

---

## 3. Signal Hire

**Track:** Spider-Sense (best clean code)
**For:** job seekers and anyone trying to read the labor market.
**What it gives them:** which startups are actually hiring, taken from their own careers pages.

**Targets.** One hundred startup careers pages. Not job boards. A mix of embedded applicant tracking systems and hand-rolled pages.

**Why it forces Scraper Studio.** Indeed, Glassdoor and LinkedIn Jobs are already in Bright Data's pre-built library, which puts them out of bounds. Company careers pages are not, and they are where the signal is freshest.

**The self-heal beat.** The hundred pages collapse into roughly four layout families. Heal across the families instead of hand-writing a parser per company. That is the whole clean-code argument: one collector, four heals, a hundred sites, and no selector file to maintain.

**Downstream and demo.** Daily schedule to Postgres, then a headcount-trend chart. On stage: "this company opened nine infrastructure roles in three weeks," with the diff that produced the claim.

**Watch out for.** Job postings name people sometimes. Drop recruiter names and contact details at extraction time. Public company data is in scope, personal data is not.

---

## Make the self-heal undeniable

Most teams hit the same wall: your target site does not conveniently redesign itself during a seven-day hackathon, so your self-healing demo becomes a staged schema extension and the judges can tell.

The fix takes twenty minutes. Host one page you control, on GitHub Pages or anywhere static. Scrape it. Break a selector on purpose, rename a class, nest a field one level deeper, then film the heal repairing it unattended.

Reliability and self-healing is one of six equally weighted judging criteria. This turns it from the hardest one to score into the easiest.

---

## Before you commit to a target

- [ ] Searched the [Scraper library](https://brightdata.com/cp/scrapers/browse) and found no match.
- [ ] Every page loads without a login and without a paywall.
- [ ] No personal data in the fields you are extracting.
- [ ] You can name the exact moment in your demo where the scraper heals.
- [ ] You can name what a judge sees on screen in the first 90 seconds.
- [ ] Your API token and `.env` are in `.gitignore` and out of the video.
