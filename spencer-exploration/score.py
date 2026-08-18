# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Merge tier-0 and tier-1 evidence into the scored site registry.

Usage:
    uv run spencer-exploration/score.py
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent

# Brands where Bright Data almost certainly ships a prebuilt scraper already.
# The organizer's guidance is to target the long tail instead, so these lose the
# novelty points and are called out in the writeup.
LIKELY_PREBUILT = {
    "ph-lazada", "ph-shopee", "us-walgreens", "us-cvs", "us-iherb",
    "us-vitaminshoppe", "us-gnc", "us-goodrx",
}

STRUCT_POINTS = {
    "json-ld": 15,
    "microdata": 12,
    "spa-with-state": 8,
    "bare-html": 6,
    "unknown": 0,
}

# Verticals that are price *references*, not basket stores. They are scored on the
# same axes but judged on a separate track: a government price monitor has no
# "basket coverage" in the retail sense, and it never joins the store fleet.
REFERENCE_VERTICALS = {"gov-price-feed", "fuel", "utility"}

# A basket tracker cannot use a store where none of the basket items were found.
MIN_BASKET_FOR_FLEET = 3

WEIGHTS = {
    "reachability": 20,
    "price_extractability": 25,
    "structured_data": 15,
    "url_stability": 10,
    "basket_coverage": 15,
    "robots": 10,
    "novelty": 5,
}


def score_site(t0: dict, t1: dict | None, manual: dict | None = None) -> dict:
    """Score one candidate from its combined tier-0 / tier-1 evidence."""
    t1v = (t1 or {}).get("tier1", {})
    t1_class = t1v.get("verdict_class")

    # Best available verdict, and how it was obtained.
    if t0["verdict_class"] == "server_rendered":
        final, access = "server_rendered", "direct"
    elif t1_class == "server_rendered":
        final, access = "server_rendered", "unlocker"
    elif t0["verdict_class"] == "spa_empty":
        final, access = "spa_empty", "direct"
    elif t1_class == "spa_empty":
        final, access = "spa_empty", "unlocker"
    else:
        final, access = "blocked", "none"

    struct = t0.get("structural_class", "unknown")
    if struct == "unknown" and t1v.get("structural_class"):
        struct = t1v["structural_class"]

    basket = {**t0.get("basket", {}), **(t1 or {}).get("basket", {})}
    coverage = len(basket)
    sitemap_urls = t0.get("sitemap", {}).get("total_urls", 0)

    s: dict[str, int] = {}
    s["reachability"] = 20 if access == "direct" else 14 if access == "unlocker" else 0
    # An SPA is not a dead end: Scraper Studio runs a real browser. It is simply
    # more fragile and more expensive than a server-rendered page.
    s["price_extractability"] = 25 if final == "server_rendered" else 12 if final == "spa_empty" else 0
    s["structured_data"] = STRUCT_POINTS.get(struct, 0)
    s["url_stability"] = 10 if sitemap_urls >= 1000 else 7 if sitemap_urls >= 100 else 4 if sitemap_urls > 0 else 0
    s["basket_coverage"] = round(coverage / 10 * WEIGHTS["basket_coverage"])
    s["robots"] = 10 if t0.get("robots_allows_product") else 0
    s["novelty"] = 0 if t0["id"] in LIKELY_PREBUILT else 5

    manual = manual or {}
    bonus = manual.get("score_bonus", 0)
    if bonus:
        s["verified_api"] = bonus

    total = sum(s.values())
    robots_excluded = not t0.get("robots_allows_product")
    role = "reference" if t0["vertical"] in REFERENCE_VERTICALS else "store"
    note = f"{final} via {access}, {coverage}/10 basket items"

    if robots_excluded:
        verdict, reason = "excluded", "robots.txt disallows the product path - public-data rule"
    elif total >= 70:
        verdict, reason = "fleet_ready", note
    elif total >= 50:
        verdict, reason = "backup", note
    else:
        verdict, reason = "reject", note

    # A store that scores well on plumbing but carries none of the basket cannot
    # anchor a basket index, however clean its markup is.
    if manual.get("verified_api") and verdict == "backup" and total >= 70:
        verdict = "fleet_ready"
        reason = f"public price API verified ({manual.get('api_kind')}); {note}"

    if role == "store" and verdict == "fleet_ready" and coverage < MIN_BASKET_FOR_FLEET:
        verdict = "backup"
        reason = (f"{final} via {access}, but only {coverage}/10 basket items "
                  f"(fleet needs {MIN_BASKET_FOR_FLEET}+)")

    evidence = t0.get("evidence_url") or t1v.get("evidence_url")
    return {
        "id": t0["id"],
        "name": t0["name"],
        "country": t0["country"],
        "vertical": t0["vertical"],
        "target_site": t0["homepage"],
        "why_candidate": t0["why"],
        "role": role,
        "verdict": verdict,
        "verdict_reason": reason,
        "score": total,
        "score_breakdown": s,
        "render_class": final,
        "access_path": access,
        "structural_class": struct,
        "needs_unlocker": access == "unlocker",
        "robots_allows_product": t0.get("robots_allows_product"),
        "robots_disallow_sample": t0.get("robots", {}).get("disallow_star", [])[:5],
        "sitemap_urls": sitemap_urls,
        "basket_coverage": coverage,
        "basket_items": {k: v.get("sample") for k, v in sorted(basket.items())},
        "evidence_url": evidence,
        "likely_prebuilt_scraper": t0["id"] in LIKELY_PREBUILT,
        "verified_api": manual.get("verified_api"),
        "api_kind": manual.get("api_kind"),
        "manual_note": manual.get("note"),
        "manual_verified_how": manual.get("verified_how"),
    }



# docs/prd.md section 2.6 wants the US fleet authenticity-weighted: real grocers
# and pharmacies ahead of online pantries, even at a slightly lower score.
AUTHENTIC_VERTICALS = ("grocery", "ethnic-grocery", "pharmacy", "convenience")


def suggest_fleet(fleet: list[dict], proven: set[str], size: int = 6) -> list[dict]:
    """Greedy pick: strongest sites, but spread across countries and markup styles.

    A fleet of six JSON-LD Shopify stores would prove almost nothing about
    self-healing - every breakage would look the same. Diversity is the point.
    """
    pool = sorted(
        fleet,
        key=lambda x: (
            x["id"] not in proven,                          # proven end to end first
            x["vertical"] not in AUTHENTIC_VERTICALS,       # then real stores
            -x["score"],
            -x["basket_coverage"],
        ),
    )
    picked: list[dict] = []
    seen_struct: set[str] = set()

    # PH first: the gate is the scarce constraint, so spend the slots there first.
    for country in ("PH", "US"):
        for s_ in pool:
            if len(picked) >= size:
                break
            if s_["country"] != country or s_ in picked:
                continue
            key = (s_["country"], s_["structural_class"])
            if key in seen_struct:
                continue
            seen_struct.add(key)
            picked.append(s_)
            if country == "PH" and len([x for x in picked if x["country"] == "PH"]) >= 3:
                break

    for s_ in pool:  # top up on raw score
        if len(picked) >= size:
            break
        if s_ not in picked:
            picked.append(s_)
    return picked[:size]


def pct(n: int, d: int) -> str:
    return f"{100 * n / d:.0f}%" if d else "-"


def write_report(registry: dict, fleet_size: int = 10) -> str:
    sites = registry["sites"]
    fleet = [s for s in sites if s["verdict"] == "fleet_ready" and s["role"] == "store"]
    backup = [s for s in sites if s["verdict"] == "backup" and s["role"] == "store"]
    refs = [s for s in sites if s["role"] == "reference" and s["verdict"] in ("fleet_ready", "backup")]
    excluded = [s for s in sites if s["verdict"] == "excluded"]
    gate = registry["ph_gate"]
    b = registry.get("budget", {})

    def row(s: dict) -> str:
        items = ", ".join(sorted(s["basket_items"])) or "-"
        access = "unlocker" if s["needs_unlocker"] else "direct"
        return (f"| {s['score']} | {s['country']} | {s['name']} | `{s['id']}` | "
                f"{s['render_class']} | {access} | {s['structural_class']} | "
                f"{s['basket_coverage']}/10 | {items} |")

    head = ("| Score | C | Site | id | Render | Access | Structure | Cat. hits | Categories |\n"
            "|---:|---|---|---|---|---|---|---|---|")

    caveat = (
        "**Read `Cat. hits` as catalogue breadth, not a product mapping.** It counts how "
        "many of the ten basket *categories* have at least one matching product URL in the "
        "site's sitemap, matched on slug keywords. It is a discovery aid: Netrition's "
        "\"bananas\" is banana-nut oatmeal, and Southstar's is a banana-flavoured medicine. "
        "Confirming the actual canonical SKU per store is a separate step before wiring "
        "each scraper."
    )

    L = []
    L.append("# Site vetting scorecard")
    L.append("")
    L.append("Generated by `spencer-exploration/score.py` from tier-0 and tier-1 evidence. "
             "Regenerate with `uv run spencer-exploration/score.py`.")
    L.append("")

    L.append("## PH gate")
    L.append("")
    L.append(f"**{'PASS' if gate['passed'] else 'FAIL'}** - "
             f"{gate['ph_fleet_ready']} PH site(s) reached `fleet_ready`; "
             f"the bar in `docs/prd.md` section 2 is 2.")
    L.append("")
    if gate["passed"]:
        L.append("PH sites join the fleet. The US-vs-PH comparison view is unblocked.")
    else:
        L.append("Ship US-only. The country dimension in the data model stays regardless, "
                 "so adding PH later costs no rework.")
    L.append("")
    for s in [x for x in fleet if x["country"] == "PH"]:
        L.append(f"- **{s['name']}** (`{s['id']}`) - score {s['score']}, "
                 f"{s['render_class']} via {'unlocker' if s['needs_unlocker'] else 'direct'}, "
                 f"{s['basket_coverage']}/10 basket categories present")
        L.append(f"  - evidence: {s['evidence_url']}")
    L.append("")

    t = registry["totals"]
    L.append("## Totals")
    L.append("")
    L.append(f"{t['candidates']} candidates probed. "
             f"US fleet-ready **{t['us_fleet_ready']}**, PH fleet-ready **{t['ph_fleet_ready']}**.")
    L.append("")
    L.append("| Verdict | Count | Share |")
    L.append("|---|---:|---:|")
    for v, n in sorted(t["by_verdict"].items(), key=lambda kv: -kv[1]):
        L.append(f"| {v} | {n} | {pct(n, t['candidates'])} |")
    L.append("")
    if b:
        L.append(f"Tier-1 cost: **${b.get('spent_usd', 0):.2f}** of a "
                 f"${b.get('cap_usd', 0):.2f} ceiling across {b.get('calls', 0)} Web Unlocker calls "
                 f"(ceiling hit: {b.get('ceiling_hit')}).")
        L.append("")

    suggested = suggest_fleet(fleet, set(registry.get("studio_proofs", {})), fleet_size)
    L.append("## Suggested starting fleet")
    L.append("")
    n_us = len([x for x in fleet if x["country"] == "US"])
    n_ph = len([x for x in fleet if x["country"] == "PH"])
    L.append(f"A starting subset of {len(suggested)}, drawn from **{len(fleet)} fleet-ready "
             f"stores** ({n_us} US, {n_ph} PH) with {len(backup)} more on the backup bench. "
             "This is a suggestion, not the ceiling - resize it with "
             "`score.py --fleet-size N`.")
    L.append("")
    L.append("Picked for spread, not just score: different countries and different markup "
             "styles, so a breakage in one does not look like a breakage in another. "
             "`docs/prd.md` asks for 4+ US scrapers plus the clone store; this clears that "
             "with PH included.")
    L.append("")
    for s_ in suggested:
        why = []
        if s_["verified_api"]:
            why.append(f"public {s_['api_kind']} endpoint")
        if s_["id"] in registry.get("studio_proofs", {}):
            why.append("already proven end to end")
        why.append(f"{s_['structural_class']} markup")
        why.append(f"{s_['basket_coverage']}/10 basket categories")
        if s_["needs_unlocker"]:
            why.append("needs Web Unlocker on every run")
        if s_["vertical"] in AUTHENTIC_VERTICALS:
            why.append(f"real {s_['vertical'].replace('-', ' ')}")
        L.append(f"- **{s_['name']}** ({s_['country']}, `{s_['id']}`, score {s_['score']}) - "
                 + "; ".join(why))
    L.append("")
    L.append("Plus Parker's Pantry, the clone store, which stays in the fleet as the "
             "scripted break-and-heal rig.")
    L.append("")

    L.append("## Fleet-ready")
    L.append("")
    L.append(caveat)
    L.append("")
    L.append(head)
    for s in fleet:
        L.append(row(s))
    L.append("")

    from collections import Counter as _C
    L.append("Structural spread across the fleet-ready set: "
             + ", ".join(f"{k} {v}" for k, v in _C(s["structural_class"] for s in fleet).most_common())
             + ".")
    L.append("")

    L.append("## Backup")
    L.append("")
    L.append("Workable, but weaker on structure, basket coverage, or access cost. "
             "Promote from here if a fleet-ready site degrades.")
    L.append("")
    L.append(head)
    for s in backup:
        L.append(row(s))
    L.append("")

    if excluded:
        L.append("## Excluded on robots.txt")
        L.append("")
        L.append("Reachable and otherwise attractive, but robots.txt disallows the product "
                 "path. The hackathon rule is public data only, so these are out regardless "
                 "of score.")
        L.append("")
        L.append("| Site | id | Disallow rules |")
        L.append("|---|---|---|")
        for s in excluded:
            rules = ", ".join(f"`{r}`" for r in s["robots_disallow_sample"]) or "-"
            L.append(f"| {s['name']} | `{s['id']}` | {rules} |")
        L.append("")

    prebuilt = [s for s in sites if s["likely_prebuilt_scraper"]]
    if prebuilt:
        L.append("## Novelty-docked")
        L.append("")
        L.append("Bright Data almost certainly ships prebuilt scrapers for these, and the "
                 "organizers asked for long-tail targets. Kept in the registry as controls, "
                 "not as fleet candidates.")
        L.append("")
        L.append(", ".join(f"{s['name']} (`{s['id']}`)" for s in prebuilt) + ".")
        L.append("")

    proofs = registry.get("studio_proofs", {})
    if proofs:
        L.append("## Proven end to end")
        L.append("")
        L.append("Scraper Studio scraper built, run against the live page, and the output fed "
                 "through this repo's own validator (`validateRun` with `priceRecordSchema`) "
                 "rather than eyeballed.")
        L.append("")
        for pid, pf in proofs.items():
            nm = next((x["name"] for x in sites if x["id"] == pid), pid)
            L.append(f"### {nm} (`{pid}`)")
            L.append("")
            L.append(f"- collector `{pf['collector_id']}` - {pf['view_url']}")
            L.append(f"- target: {pf['target']}")
            L.append(f"- row: `{json.dumps(pf['row'])}`")
            L.append(f"- validator: **{pf['validator']}**")
            L.append(f"- {pf['significance']}")
            L.append("")

    api_sites = [x for x in sites if x.get("verified_api")]
    if api_sites:
        L.append("## Verified public price APIs")
        L.append("")
        L.append("Hand-verified during exploration. A site whose page markup is an empty SPA "
                 "shell can still be a first-class target if it exposes a public structured "
                 "endpoint - and an API-backed scraper is far less likely to need healing "
                 "than a selector-based one.")
        L.append("")
        for x in api_sites:
            L.append(f"- **{x['name']}** (`{x['id']}`) - `{x['verified_api']}` "
                     f"({x['api_kind']})")
            L.append(f"  - {x['manual_note']}")
            L.append(f"  - verified: {x['manual_verified_how']}")
        L.append("")

    if refs:
        L.append("## Reference price feeds")
        L.append("")
        L.append("Government and institutional price monitors. These never join the store "
                 "fleet - they have no retail basket - but they give the validator a "
                 "ground-truth oracle to sanity-check scraped prices against, which is "
                 "exactly what \"the basket index that never lies\" needs.")
        L.append("")
        L.append(head)
        for s_ in refs:
            L.append(row(s_))
        L.append("")

    L.append("## Scoring")
    L.append("")
    L.append("| Dimension | Weight |")
    L.append("|---|---:|")
    for k, v in registry["scoring_weights"].items():
        L.append(f"| {k} | {v} |")
    L.append("")
    L.append("`fleet_ready` >= 70, `backup` 50-69, `reject` < 50. A robots.txt disallow on "
             "the product path is an exclusion, not a penalty.")
    L.append("")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fleet-size", type=int, default=10,
                    help="how many sites the suggested starting fleet should name")
    args = ap.parse_args()

    t0 = json.loads((HERE / "tier0.json").read_text())["results"]
    t1_path = HERE / "tier1.json"
    t1_doc = json.loads(t1_path.read_text()) if t1_path.exists() else {"results": [], "budget": {}}
    t1_by_id = {r["id"]: r for r in t1_doc["results"]}

    mf_path = HERE / "manual-findings.json"
    mf = json.loads(mf_path.read_text()) if mf_path.exists() else {}
    manual = mf.get("findings", {})
    proofs = {k: v for k, v in mf.get("studio_proofs", {}).items() if not k.startswith("_")}
    sites = [score_site(r, t1_by_id.get(r["id"]), manual.get(r["id"])) for r in t0]
    sites.sort(key=lambda x: (-x["score"], x["country"], x["id"]))

    counts = Counter(s["verdict"] for s in sites)
    by_country: dict[str, Counter] = defaultdict(Counter)
    for s in sites:
        by_country[s["country"]][s["verdict"]] += 1

    fleet = [s for s in sites if s["verdict"] == "fleet_ready" and s["role"] == "store"]
    refs = [s for s in sites if s["role"] == "reference" and s["verdict"] in ("fleet_ready", "backup")]
    ph_ready = [s for s in fleet if s["country"] == "PH"]
    us_ready = [s for s in fleet if s["country"] == "US"]

    registry = {
        "generated": "tier0 + tier1 evidence, see spencer-exploration/README.md",
        "scoring_weights": WEIGHTS,
        "totals": {
            "candidates": len(sites),
            "by_verdict": dict(counts),
            "by_country": {k: dict(v) for k, v in by_country.items()},
            "us_fleet_ready": len(us_ready),
            "ph_fleet_ready": len(ph_ready),
            "reference_feeds_usable": len(refs),
        },
        "reference_feeds": [s["id"] for s in refs],
        "ph_gate": {
            "requirement": "at least 2 PH sites vetting cleanly (docs/prd.md section 2)",
            "ph_fleet_ready": len(ph_ready),
            "passed": len(ph_ready) >= 2,
            "sites": [s["id"] for s in ph_ready],
        },
        "budget": t1_doc.get("budget", {}),
        "studio_proofs": proofs,
        "sites": sites,
    }
    (HERE / "registry.json").write_text(json.dumps(registry, indent=2))
    (HERE / "registry.md").write_text(write_report(registry, args.fleet_size))

    print(f"scored {len(sites)} candidates")
    for v, n in counts.most_common():
        print(f"  {v:<12} {n}")
    print(f"\nUS fleet_ready: {len(us_ready)}   PH fleet_ready: {len(ph_ready)}")
    print(f"PH GATE: {'PASS' if len(ph_ready) >= 2 else 'FAIL'}")
    print(f"reference feeds usable: {len(refs)}")
    print("\nstructural classes among fleet_ready:",
          dict(Counter(s["structural_class"] for s in fleet)))
    print("\ntop 20:")
    for s in sites[:20]:
        print(f"  {s['score']:>3}  {s['country']} {s['id']:<24} {s['verdict']:<12} "
              f"{s['structural_class']:<15} basket={s['basket_coverage']}/10")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
