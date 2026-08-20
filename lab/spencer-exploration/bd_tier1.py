# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx[http2]"]
# ///
"""Tier-1 vetting via Bright Data Web Unlocker, with a hard credit ceiling.

Only runs on candidates tier 0 could not settle (blocked / spa_empty /
no_product_urls). Reuses vet.py's classifier so tier-0 and tier-1 verdicts are
directly comparable.

Usage:
    uv run lab/spencer-exploration/bd_tier1.py --cap-usd 5.0
    uv run lab/spencer-exploration/bd_tier1.py --cap-usd 1.0 --ids ph-watsons us-riteaid
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from vet import (  # noqa: E402
    basket_map,
    classify,
    parse_robots,
    parse_sitemap,
    product_score,
    structural_class,
)

API = "https://api.brightdata.com/request"
ZONE = os.environ.get("BRIGHTDATA_UNLOCKER_ZONE", "cli_unlocker")
CONCURRENCY = 5
RETRY_STATUSES = {429, 500, 502, 503, 504}

NEEDS_TIER1 = {"blocked", "spa_empty", "no_product_urls"}


def read_balance(attempts: int = 3) -> float | None:
    """Authoritative spend check, straight from the account.

    Retried, because a single slow CLI call should not look like a dead account -
    refusing to spend blind is right, but only after actually trying.
    """
    for i in range(attempts):
        try:
            out = subprocess.run(
                ["bdata", "budget"], capture_output=True, text=True, timeout=90
            ).stdout
            m = re.search(r"Balance\s+\$([0-9.,]+)", out)
            if m:
                return float(m.group(1).replace(",", ""))
        except Exception:  # noqa: BLE001
            pass
        if i < attempts - 1:
            time.sleep(2 * (i + 1))
    return None


class Budget:
    """Hard ceiling on Bright Data spend for this run."""

    POLL_SECONDS = 25.0
    EST_PER_CALL = 0.004  # deliberately pessimistic vs published Unlocker pricing

    def __init__(self, cap_usd: float):
        self.cap = cap_usd
        self._last_read = 0.0
        self._last_spent = 0.0
        self._calls_at_read = 0
        self.start = read_balance()
        self.calls = 0
        self.tripped = False
        if self.start is None:
            raise SystemExit("could not read Bright Data balance - refusing to spend blind")

    def spent(self, force: bool = True) -> float:
        """Spend so far, from the live account balance. Cached briefly when polling."""
        if not force and time.monotonic() - self._last_read < self.POLL_SECONDS:
            return self._last_spent
        now = read_balance()
        self._last_read = time.monotonic()
        if now is not None:
            self._last_spent = max(0.0, self.start - now)
            self._calls_at_read = self.calls
        return self._last_spent

    def check(self) -> bool:
        """True if it is still safe to spend. Trips permanently once breached.

        Balance reads are throttled - each is a CLI round-trip - so between reads
        the ceiling is also enforced against a deliberately pessimistic per-call
        estimate. That way a burst of calls cannot slip past the cap in the gap.
        """
        if self.tripped:
            return False
        est = self._last_spent + (self.calls - self._calls_at_read) * self.EST_PER_CALL
        actual = self.spent(force=est >= self.cap * 0.8)
        if actual >= self.cap or est >= self.cap:
            self.tripped = True
            print(f"\n!! BUDGET CEILING HIT: ${actual:.2f} spent (est ${est:.2f}) "
                  f"of ${self.cap:.2f} after {self.calls} calls - stopping tier 1")
        return not self.tripped


async def unlock(client: httpx.AsyncClient, url: str, country: str, api_key: str) -> dict:
    """One Web Unlocker fetch, shaped like a vet.py response record."""
    payload = {"zone": ZONE, "url": url, "format": "raw", "country": country.lower()}
    for attempt in range(3):
        try:
            r = await client.post(
                API,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=120.0,
            )
            if r.status_code in RETRY_STATUSES and attempt < 2:
                await asyncio.sleep(3 * (attempt + 1))
                continue
            return {
                "url": url,
                "status": r.status_code,
                "final_url": url,
                "bytes": len(r.content),
                "headers": {},
                "body": r.text[:2_000_000],
                "error": None,
            }
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                return {
                    "url": url, "status": 0, "final_url": url, "bytes": 0,
                    "headers": {}, "body": "", "error": f"{type(e).__name__}: {e}"[:200],
                }
            await asyncio.sleep(3 * (attempt + 1))
    return {"url": url, "status": 0, "final_url": url, "bytes": 0, "headers": {}, "body": "", "error": "unreachable"}


def links_from(html: str, base: str, hints: list[str]) -> list[str]:
    """Product-looking links off a page we just unlocked."""
    hrefs = re.findall(r'href\s*=\s*["\']([^"\'#]+)["\']', html, re.I)
    host = urlparse(base).netloc
    scored = []
    for h in hrefs:
        u = urljoin(base, h).split("?")[0]
        if urlparse(u).netloc != host:
            continue
        sc = product_score(u, hints)
        if sc >= 3:
            scored.append((sc, u))
    seen, out = set(), []
    for _, u in sorted(scored, key=lambda t: -t[0]):
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


async def sitemap_via_unlocker(
    client: httpx.AsyncClient, home: str, country: str, api_key: str,
    hints: list[str], budget: "Budget", calls: list[dict],
) -> list[str]:
    """Last resort for sites whose robots/sitemap were blocked at tier 0."""
    base = f"{urlparse(home).scheme}://{urlparse(home).netloc}"
    if not budget.check():
        return []
    rb = await unlock(client, urljoin(base, "/robots.txt"), country, api_key)
    budget.calls += 1
    calls.append({"url": "/robots.txt", "status": rb["status"], "bytes": rb["bytes"], "role": "robots"})
    sms = parse_robots(rb["body"])["sitemaps"] if rb["status"] == 200 else []
    sms = (sms or []) + [urljoin(base, "/sitemap.xml"), urljoin(base, "/sitemap_index.xml")]

    for sm in sms[:2]:
        if not budget.check():
            break
        r = await unlock(client, sm, country, api_key)
        budget.calls += 1
        calls.append({"url": sm, "status": r["status"], "bytes": r["bytes"], "role": "sitemap"})
        if r["status"] != 200:
            continue
        pages, nested = parse_sitemap(r["body"])
        if not pages and nested and budget.check():
            nr = await unlock(client, nested[0], country, api_key)
            budget.calls += 1
            calls.append({"url": nested[0], "status": nr["status"], "bytes": nr["bytes"], "role": "sitemap"})
            if nr["status"] == 200:
                pages, _ = parse_sitemap(nr["body"])
        picks = sorted(
            ((product_score(u, hints), u) for u in pages), key=lambda t: -t[0]
        )
        good = [u for sc, u in picks if sc >= 3]
        if good:
            return good
    return []


async def tier1_site(
    rec: dict, cand: dict, client: httpx.AsyncClient, api_key: str, budget: Budget, sem: asyncio.Semaphore
) -> dict:
    async with sem:
        if not budget.check():
            return {**rec, "tier1": {"skipped": "budget ceiling"}}

        country = rec["country"]
        hints = cand.get("product_hint", [])
        home = rec["homepage"]
        calls: list[dict] = []

        # Product URLs already known from the tier-0 sitemap? Go straight at them.
        picks = [p["url"] for p in rec.get("product_probes", [])][:2]

        if not picks:
            hp = await unlock(client, home, country, api_key)
            budget.calls += 1
            calls.append({"url": home, "status": hp["status"], "bytes": hp["bytes"], "role": "home"})
            found = links_from(hp["body"], home, hints)
            bm = basket_map(found)
            picks = [v["sample"] for v in bm.values()][:2] or found[:2]
            if bm:
                rec = {**rec, "basket": {**rec.get("basket", {}), **bm}, "basket_coverage": len(bm)}
            if not picks:
                found = await sitemap_via_unlocker(
                    client, home, country, api_key, hints, budget, calls
                )
                bm2 = basket_map(found)
                picks = [v["sample"] for v in bm2.values()][:2] or found[:2]
                if bm2:
                    rec = {**rec, "basket": {**rec.get("basket", {}), **bm2},
                           "basket_coverage": len({**rec.get("basket", {}), **bm2})}
            if not picks:
                hc = classify(hp)
                return {
                    **rec,
                    "tier1": {
                        "calls": calls, "probes": [],
                        "verdict_class": "blocked" if hc["class"] == "blocked" else "no_product_urls",
                        "note": hc["reason"],
                    },
                }

        probes = []
        for u in picks[:2]:
            if not budget.check():
                break
            pr = await unlock(client, u, country, api_key)
            budget.calls += 1
            calls.append({"url": u, "status": pr["status"], "bytes": pr["bytes"], "role": "product"})
            c = classify(pr)
            probes.append({"url": u, "status": pr["status"], "bytes": pr["bytes"],
                           "class": c["class"], "reason": c["reason"], "signals": c["signals"]})

        classes = [p["class"] for p in probes]
        v = ("server_rendered" if "server_rendered" in classes
             else "spa_empty" if "spa_empty" in classes
             else "blocked" if classes else "no_product_urls")
        best = next((p for p in probes if p["class"] == v), probes[0] if probes else None)

        out = {
            **rec,
            "tier1": {
                "calls": calls,
                "probes": probes,
                "verdict_class": v,
                "structural_class": structural_class(best["signals"]) if best else "unknown",
                "evidence_url": best["url"] if best else None,
            },
        }
        print(f"  {rec['id']:<24} tier0={rec['verdict_class']:<16} -> tier1={v:<16} "
              f"struct={out['tier1']['structural_class']}", flush=True)
        return out


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap-usd", type=float, default=5.0)
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--tier0", default=str(HERE / "tier0.json"))
    ap.add_argument("--candidates", default=str(HERE / "candidates.json"))
    ap.add_argument("--out", default=str(HERE / "tier1.json"))
    args = ap.parse_args()

    api_key = os.environ.get("BRIGHTDATA_API_KEY")
    if not api_key:
        raise SystemExit("BRIGHTDATA_API_KEY not set (source the repo .env first)")

    t0 = json.loads(Path(args.tier0).read_text())["results"]
    cands = {c["id"]: c for c in json.loads(Path(args.candidates).read_text())["candidates"]}

    todo = [r for r in t0 if r["verdict_class"] in NEEDS_TIER1]
    if args.ids:
        todo = [r for r in todo if r["id"] in args.ids]

    budget = Budget(args.cap_usd)
    print(f"tier-1 unlocker sweep: {len(todo)} sites, cap ${args.cap_usd:.2f}, "
          f"starting balance ${budget.start:.2f}\n", flush=True)

    sem = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(http2=True) as client:
        results = await asyncio.gather(
            *(tier1_site(r, cands[r["id"]], client, api_key, budget, sem) for r in todo),
            return_exceptions=True,
        )

    ok, failed = [], []
    for r, res in zip(todo, results):
        if isinstance(res, BaseException):
            failed.append({"id": r["id"], "error": f"{type(res).__name__}: {res}"})
        else:
            ok.append(res)

    spent = budget.spent()
    Path(args.out).write_text(json.dumps(
        {"results": ok, "harness_failures": failed,
         "budget": {"cap_usd": args.cap_usd, "calls": budget.calls,
                    "start_balance": budget.start, "spent_usd": round(spent, 4),
                    "ceiling_hit": budget.tripped}},
        indent=2))

    from collections import defaultdict
    tally: dict[str, int] = defaultdict(int)
    for r in ok:
        tally[r.get("tier1", {}).get("verdict_class", "skipped")] += 1
    print("\n--- tier-1 summary ---")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<18} {v}")
    if failed:
        print(f"  HARNESS FAILURES  {len(failed)}: {[x['id'] for x in failed]}")
    print(f"\ncalls={budget.calls}  spent=${spent:.2f} of ${args.cap_usd:.2f}  ceiling_hit={budget.tripped}")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
