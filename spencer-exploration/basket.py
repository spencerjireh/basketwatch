# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx[http2]"]
# ///
"""Build the per-store basket: one concrete product URL per canonical item.

The registry proves a site is scrapeable. This proves it sells the basket - and
pins exactly which product each scraper must return, so the index compares like
with like and the validator can tell a price move from a scraper fault.

Usage:
    uv run spencer-exploration/basket.py                 # all locked stores
    uv run spencer-exploration/basket.py --ids ph-shopgaisano
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

from urllib.parse import urlparse

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from vet import (  # noqa: E402
    HEADERS,
    Fetcher,
    NON_GROCERY,
    discover_urls,
)

# What the basket is meant to be, per docs/prd.md section 5. "target" is the
# canonical size; stores rarely match it exactly, so the found size is recorded
# and normalisation happens downstream rather than being faked here.
BASKET_SPEC = {
    "rice":        {"target_us": "5 lb",   "target_ph": "5 kg",  "must": ["rice", "bigas"]},
    "eggs":        {"target_us": "dozen",  "target_ph": "tray",  "must": ["egg", "eggs", "itlog"]},
    "milk":        {"target_us": "1 gal",  "target_ph": "1 L",   "must": ["milk", "gatas"]},
    "bread":       {"target_us": "loaf",   "target_ph": "loaf",  "must": ["bread", "loaf", "tinapay", "pandesal"]},
    "coffee":      {"target_us": "12 oz",  "target_ph": "sachets", "must": ["coffee", "kape"]},
    "sugar":       {"target_us": "4 lb",   "target_ph": "1 kg",  "must": ["sugar", "asukal"]},
    "chicken":     {"target_us": "per lb", "target_ph": "per kg", "must": ["chicken", "manok"]},
    "cooking_oil": {"target_us": "48 oz",  "target_ph": "1 L",   "must": ["oil", "mantika"]},
    "pasta":       {"target_us": "1 lb",   "target_ph": "500 g", "must": ["pasta", "spaghetti", "macaroni", "penne"]},
    "bananas":     {"target_us": "per lb", "target_ph": "per kg", "must": ["banana", "bananas", "saging"]},
}

# Terms that mean "this is a different product that merely shares a word".
# Rice vinegar is not rice; banana bread is not bananas; a coffee grinder is not coffee.
ITEM_EXCLUDE = {
    "rice":        ["cake", "cracker", "vinegar", "wine", "paper", "noodle", "cereal",
                    "pudding", "flour", "bran", "krispie", "fried", "syrup", "drink", "milk"],
    "eggs":        ["replacer", "whisk", "plant", "nog", "substitute", "holder", "cooker", "roll"],
    "milk":        ["chocolate", "candy", "shake", "bar", "soap", "bath", "tea", "coffee",
                    "biscuit", "cookie", "thistle", "of magnesia", "cleanser", "bath-milk"],
    "bread":       ["crumb", "crumbs", "stick", "pudding", "spread", "machine", "board",
                    "banana", "knife", "basket", "beef", "pork", "meat", "luncheon",
                    "chicken", "corned", "sandwich", "garlic", "toast"],
    "coffee":      ["maker", "filter", "grinder", "press", "cake", "creamer", "scrub",
                    "candy", "liqueur", "cup", "pod-machine", "syrup", "jelly", "biscuit",
                    "wafer", "yogurt", "ice-cream"],
    "sugar":       ["free", "substitute", "scrub", "cookie", "coated", "snap-pea", "snap"],
    "chicken":     ["feed", "flavor", "flavour", "broth", "stock", "cube", "seasoning",
                    "spread", "noodle", "sandwich", "pet", "treat", "soup", "gumbo",
                    "snack", "chips", "curry", "nugget", "nuggets", "loaf", "spaghetti"],
    "cooking_oil": ["motor", "engine", "massage", "essential", "hair", "body", "lamp",
                    "diffuser", "tea-tree", "castor", "baby"],
    "pasta":       ["sauce", "salad", "maker", "strainer", "server", "bowl", "seasoning"],
    "bananas":     ["bread", "chip", "chips", "flavor", "flavour", "split", "puree",
                    "dried", "candy", "milk", "shake", "leaf", "boat", "catsup",
                    "ketchup", "cereal", "flakes", "cake", "yogurt", "juice", "sauce"],
}

# A store's own taxonomy is a far stronger signal than any keyword list. "Sugar Kids
# Girls' Grace Sandals" only reads as sugar to a text matcher; its category never does.
NON_FOOD_CATEGORY = (
    "home", "outdoor", "health", "beauty", "baby", "kids", "toys", "pet", "pets",
    "apparel", "clothing", "shoes", "stationery", "stationary", "appliance",
    "appliances", "electronics", "furniture", "hardware", "auto", "garden", "sports",
    "miniso", "household", "households", "cleaning", "laundry", "pharmacy", "wellness",
    "beer", "wine", "spirits", "liquor", "tobacco", "cigarettes",
)

PREFERRED_CATEGORY = {
    "rice":        ("rice", "grain", "grains", "pantry", "staple", "staples", "grocery"),
    "eggs":        ("egg", "eggs", "dairy", "chilled", "fresh", "breakfast"),
    "milk":        ("milk", "dairy", "chilled", "fresh", "beverage", "beverages"),
    "bread":       ("bread", "bakery", "baked", "breakfast"),
    "coffee":      ("coffee", "beverage", "beverages", "tea", "pantry", "grocery"),
    "sugar":       ("sugar", "sweetener", "baking", "pantry", "grocery", "staple"),
    "chicken":     ("chicken", "poultry", "meat", "butcher", "fresh", "frozen", "seafood"),
    "cooking_oil": ("oil", "cooking", "condiment", "condiments", "pantry", "grocery"),
    "pasta":       ("pasta", "noodle", "noodles", "pantry", "grocery", "staple"),
    "bananas":     ("banana", "fruit", "fruits", "produce", "vegetable", "vegetables", "fresh"),
}


def category_segments(url: str) -> list[str]:
    segs = urlparse(url).path.strip("/").split("/")
    return [w for seg in segs[:-1] for w in re.split(r"[^a-z0-9]+", seg.lower()) if w]


def category_verdict(item: str, url: str) -> str:
    """'good' | 'bad' | 'unknown' - what the URL's own category path says."""
    words = category_segments(url)
    if not words:
        return "unknown"
    if any(w in NON_FOOD_CATEGORY for w in words):
        return "bad"
    if any(w in PREFERRED_CATEGORY[item] for w in words):
        return "good"
    return "unknown"


# Slug words that mark a plain staple rather than a prepared or premium variant.
STAPLE_BONUS = ("great value", "value", "classic", "plain", "white", "fresh", "whole",
                "regular", "original", "premium", "all purpose")

RE_SIZE = re.compile(
    r"(?<![\d/])(\d+(?:\.\d+)?(?:\s*/\s*\d+)?)\s*-?\s*"
    r"(oz|lb|lbs|ml|l|g|kg|ct|pk|pack|dozen|gal|qt|pcs|pc|liter|litre)\b",
    re.I,
)
RE_LD_BLOCK = re.compile(
    r'<script[^>]+type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.I | re.S,
)
RE_MICRO_NAME = re.compile(r'itemprop\s*=\s*["\']name["\'][^>]*content\s*=\s*["\']([^"\']{3,120})', re.I)
RE_MICRO_PRICE = re.compile(r'itemprop\s*=\s*["\']price["\'][^>]*content\s*=\s*["\']([\d.,]+)', re.I)
RE_OG_TITLE = re.compile(r'property\s*=\s*["\']og:title["\'][^>]*content\s*=\s*["\']([^"\']{3,120})', re.I)
RE_OG_PRICE = re.compile(
    r'property\s*=\s*["\'](?:product:price:amount|og:price:amount)["\'][^>]*content\s*=\s*["\']([\d.,]+)', re.I
)


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def extract_product(html: str) -> dict | None:
    """Pull name/price/currency out of a product page, structured sources first."""
    for block in RE_LD_BLOCK.findall(html or ""):
        try:
            data = json.loads(block.strip())
        except (json.JSONDecodeError, ValueError):
            continue
        for node in _walk(data):
            types = node.get("@type")
            types = [types] if isinstance(types, str) else (types or [])
            if not any(t in ("Product", "IndividualProduct") for t in types):
                continue
            name = node.get("name")
            offers = node.get("offers") or {}
            offers = offers[0] if isinstance(offers, list) and offers else offers
            price = offers.get("price") or offers.get("lowPrice") if isinstance(offers, dict) else None
            cur = offers.get("priceCurrency") if isinstance(offers, dict) else None
            if name and price:
                try:
                    return {"name": str(name)[:150], "price": float(str(price).replace(",", "")),
                            "currency": cur, "via": "json-ld"}
                except ValueError:
                    continue

    n, p = RE_MICRO_NAME.search(html or ""), RE_MICRO_PRICE.search(html or "")
    if n and p:
        try:
            return {"name": n.group(1)[:150], "price": float(p.group(1).replace(",", "")),
                    "currency": None, "via": "microdata"}
        except ValueError:
            pass

    n, p = RE_OG_TITLE.search(html or ""), RE_OG_PRICE.search(html or "")
    if n and p:
        try:
            return {"name": n.group(1)[:150], "price": float(p.group(1).replace(",", "")),
                    "currency": None, "via": "og"}
        except ValueError:
            pass
    return None


def size_of(text: str) -> str | None:
    m = RE_SIZE.search(text or "")
    if not m:
        return None
    return f"{re.sub(r'\s+', '', m.group(1))}{m.group(2).lower()}"


def slug_words(url: str) -> str:
    seg = url.rstrip("/").rsplit("/", 1)[-1]
    return " " + re.sub(r"[^a-z0-9]+", " ", seg.lower()).strip() + " "


def name_is_the_staple(item: str, name: str) -> bool:
    """Does the product's own title agree that this is the basket staple?"""
    w = " " + re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip() + " "
    if not any(f" {m} " in w for m in BASKET_SPEC[item]["must"]):
        return False
    if any(f" {x.replace('-', ' ')} " in w for x in ITEM_EXCLUDE[item]):
        return False
    if any(f" {g.replace('-', ' ')} " in w for g in NON_GROCERY):
        return False
    return True


def rank_candidates(item: str, urls: list[str]) -> list[tuple[int, str]]:
    """Score how likely each URL is to be the plain staple for this basket item."""
    spec = BASKET_SPEC[item]
    excl = ITEM_EXCLUDE[item]
    out = []
    for u in urls:
        w = slug_words(u)
        if not any(f" {m} " in w for m in spec["must"]):
            continue
        if any(f" {x.replace('-', ' ')} " in w for x in excl):
            continue
        if any(f" {g.replace('-', ' ')} " in w for g in NON_GROCERY):
            continue
        cat = category_verdict(item, u)
        if cat == "bad":
            continue
        score = 6 if cat == "good" else 0
        if size_of(w):
            score += 4                      # a size token is what makes it comparable
        if any(b in w for b in STAPLE_BONUS):
            score += 2
        wordcount = len(w.split())
        score += 3 if wordcount <= 6 else 1 if wordcount <= 9 else 0   # plainer slug wins
        out.append((score, u))
    return sorted(out, key=lambda t: -t[0])


async def shopify_basket(base: str) -> dict:
    """Shopify's public suggest.json returns the store's own relevance ranking."""
    items: dict = {}
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=40) as c:
        for item, spec in BASKET_SPEC.items():
            best = None
            for term in spec["must"]:
                try:
                    r = await c.get(f"{base}/search/suggest.json", params={
                        "q": term, "resources[type]": "product", "resources[limit]": 10})
                    hits = r.json()["resources"]["results"]["products"]
                except Exception as e:  # noqa: BLE001
                    items[item] = {"status": "error", "note": f"{type(e).__name__}: {e}"[:120]}
                    hits = []
                for h in hits:
                    if not h.get("available", True):
                        continue
                    if not name_is_the_staple(item, h.get("title", "")):
                        continue
                    taxonomy = " ".join(h.get("tags") or []) + " " + (h.get("type") or "")
                    tw = [w for w in re.split(r"[^a-z0-9]+", taxonomy.lower()) if w]
                    if tw and any(w in NON_FOOD_CATEGORY for w in tw):
                        continue
                    h["_taxonomy"] = taxonomy.strip()
                    best = h
                    break
                if best:
                    break
            if not best:
                items[item] = {"status": "not_found", "note": "search returned no plain staple"}
                continue
            items[item] = {
                "url": base + best["url"].split("?")[0],
                "name": best["title"],
                "price": float(str(best.get("price", "0")).replace(",", "")),
                "currency": None,
                "size": size_of(best["title"]),
                "status": "verified",
                "via": "shopify-search",
                "store_taxonomy": best.get("_taxonomy") or None,
            }
    return items


async def graphql_basket(country_cur: str) -> dict:
    """SM Markets ships a public Magento GraphQL endpoint - ask it directly."""
    items: dict = {}
    q = ('{{products(search:"{term}",pageSize:12){{items{{name url_key '
         'price_range{{minimum_price{{final_price{{value currency}}}}}}}}}}}}')
    async with httpx.AsyncClient(headers=HEADERS, timeout=40) as c:
        for item, spec in BASKET_SPEC.items():
            term = spec["must"][0]
            try:
                r = await c.get("https://smmarkets.ph/graphql", params={"query": q.format(term=term)})
                nodes = r.json()["data"]["products"]["items"]
            except Exception as e:  # noqa: BLE001
                items[item] = {"status": "error", "note": f"{type(e).__name__}: {e}"[:120]}
                continue
            best = next((n for n in nodes if name_is_the_staple(item, n["name"])), None)
            if not best:
                items[item] = {"status": "not_found", "note": f"{len(nodes)} results, none a plain staple"}
                continue
            fp = best["price_range"]["minimum_price"]["final_price"]
            items[item] = {
                "url": f"https://smmarkets.ph/{best['url_key']}.html",
                "name": best["name"],
                "price": float(fp["value"]),
                "currency": fp["currency"],
                "size": size_of(best["name"]),
                "status": "verified",
                "via": "graphql",
            }
    return items


async def build_store(entry: dict, cand: dict, f: Fetcher) -> dict:
    country = entry["country"]
    store = {
        "id": entry["id"], "name": entry["name"], "country": country,
        "structural_class": entry["structural_class"], "items": {}, "unresolved": [],
    }

    if entry.get("search_api") == "magento-graphql":
        store["items"] = await graphql_basket(country)
    elif entry.get("search_api") == "shopify":
        store["items"] = await shopify_basket(cand["homepage"].rstrip("/"))
    else:
        disc = await discover_urls(cand, f)
        pool = disc["product_urls"] or disc["page_urls"]
        store["pool_size"] = len(pool)
        store["discovery"] = disc["via"]
        for item in BASKET_SPEC:
            ranked = rank_candidates(item, pool)
            if not ranked:
                store["items"][item] = {"status": "not_found", "note": "no candidate URL in pool"}
                continue
            picked = None
            for _, url in ranked[:4]:
                r = await f.get(url, "basket", timeout=25)
                if r["status"] != 200:
                    continue
                info = extract_product(r["body"])
                if info and info["price"] > 0 and name_is_the_staple(item, info["name"]):
                    picked = {
                        "url": url, "name": info["name"], "price": info["price"],
                        "currency": info["currency"], "size": size_of(info["name"]) or size_of(url),
                        "status": "verified", "via": info["via"],
                    }
                    break
            if picked is None:
                top = ranked[0][1]
                picked = {
                    "url": top, "name": None, "price": None, "currency": None,
                    "size": size_of(slug_words(top)),
                    "status": "candidate_unverified",
                    "note": "URL selected from the sitemap but the page serves no price "
                            "over plain HTTP - confirm with a Studio run",
                }
            store["items"][item] = picked

    ov = (json.loads((HERE / "manual-basket.json").read_text())["overrides"]
          if (HERE / "manual-basket.json").exists() else {}).get(entry["id"], {})
    for item, fix in ov.items():
        store["items"][item] = {
            "url": fix["url"], "name": fix["name"], "price": None, "currency": None,
            "size": size_of(fix["name"]), "status": "curated",
            "via": "manual", "why": fix["why"],
        }

    tgt = "target_ph" if country == "PH" else "target_us"
    for item, rec in store["items"].items():
        rec["target_size"] = BASKET_SPEC[item][tgt]
        if rec.get("status") not in ("verified", "curated"):
            store["unresolved"].append(item)
    store["verified_count"] = sum(
        1 for r in store["items"].values() if r.get("status") in ("verified", "curated"))
    store["chosen_url_count"] = sum(1 for r in store["items"].values() if r.get("url"))
    print(f"  {entry['id']:<24} settled {store['verified_count']}/10  "
          f"urls {store['chosen_url_count']}/10  "
          f"open: {','.join(store['unresolved']) or '-'}", flush=True)
    return store


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--out", default=str(HERE / "basket-map.json"))
    args = ap.parse_args()

    lock = json.loads((HERE / "fleet.lock.json").read_text())
    cands = {c["id"]: c for c in json.loads((HERE / "candidates.json").read_text())["candidates"]}
    fleet = [e for e in lock["fleet"] if not args.ids or e["id"] in args.ids]

    print(f"building basket for {len(fleet)} locked stores\n", flush=True)
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, http2=True) as client:
        f = Fetcher(client, use_cache=True)
        stores = [await build_store(e, cands[e["id"]], f) for e in fleet]

    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "spec": BASKET_SPEC,
        "stores": {s["id"]: s for s in stores},
        "totals": {
            "stores": len(stores),
            "verified_items": sum(s["verified_count"] for s in stores),
            "possible_items": len(stores) * len(BASKET_SPEC),
        },
    }
    Path(args.out).write_text(json.dumps(doc, indent=2))

    L = ["# Per-store basket map", "",
         "One concrete product per canonical basket item, per locked store. Generated by",
         "`spencer-exploration/basket.py`; hand corrections live in `manual-basket.json`.", "",
         "Status meanings: **verified** - the page served a name and price over plain HTTP.",
         "**curated** - hand-picked because automated selection chose a lookalike.",
         "**candidate_unverified** - URL chosen and category-checked, but the page serves no",
         "price without a browser, so a Studio run has to confirm it. **not_found** - the",
         "store's public catalogue has no such staple.", ""]
    for st in stores:
        L += [f"## {st['name']} ({st['country']}) - {st['verified_count']}/10 settled, "
              f"{st.get('chosen_url_count', 0)}/10 with a chosen URL", "",
              "| Item | Target | Status | Size | Price | Product |", "|---|---|---|---|---|---|"]
        for item, r in st["items"].items():
            price = f"{r['price']:.2f}" if r.get("price") else "-"
            L.append(f"| {item} | {r.get('target_size', '-')} | {r['status']} | "
                     f"{r.get('size') or '-'} | {price} | {(r.get('name') or r.get('note') or '-')[:70]} |")
        L.append("")
        for item, r in st["items"].items():
            if r.get("why"):
                L.append(f"- **{item}** curated: {r['why']}")
        L.append("")
    Path(args.out).with_suffix(".md").write_text("\n".join(L))
    t = doc["totals"]
    print(f"\nverified {t['verified_items']}/{t['possible_items']} store-item pairs")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
