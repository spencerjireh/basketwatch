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
    cache_path,
    discover_urls,
)

ITEMS_PATH = HERE / "items.json"


def load_items(path: Path = ITEMS_PATH) -> dict:
    """The tracked item registry. Items and units are data, never code."""
    doc = json.loads(path.read_text())
    return {i["key"]: i for i in doc["items"] if i["tier"] in ("core", "stretch")}


ITEMS = load_items()
CORE_ITEMS = [k for k, v in ITEMS.items() if v["tier"] == "core"]


def must_terms(item: str, country: str) -> list[str]:
    m = ITEMS[item]["match"]
    return list(m["must"]) + list(m.get("must_by_country", {}).get(country, []))


def exclude_terms(item: str) -> list[str]:
    return ITEMS[item]["match"]["exclude"]


# A store's own taxonomy is a far stronger signal than any keyword list. "Sugar Kids
# Girls' Grace Sandals" only reads as sugar to a text matcher; its category never does.
NON_FOOD_CATEGORY = (
    "home", "outdoor", "health", "beauty", "baby", "kids", "toys", "pet", "pets",
    "apparel", "clothing", "shoes", "stationery", "stationary", "appliance",
    "appliances", "electronics", "furniture", "hardware", "auto", "garden", "sports",
    "miniso", "household", "households", "cleaning", "laundry", "pharmacy", "wellness",
    "beer", "wine", "spirits", "liquor", "tobacco", "cigarettes",
)

def preferred_categories(item: str) -> tuple[str, ...]:
    return tuple(ITEMS[item]["categories"])


# Category words that mark a path as food without naming the item: Landers files rice
# under /food-cupboard/, which no per-item list would ever guess. Rejection is already
# handled by NON_FOOD_CATEGORY, so these only ever grant the bonus.
GENERIC_FOOD_CATEGORY = (
    "food", "foods", "cupboard", "grocery", "groceries", "pantry", "staple", "staples",
    "essentials", "dry", "goods", "supermarket", "edible", "consumables",
)


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
    if any(w in preferred_categories(item) or w in GENERIC_FOOD_CATEGORY for w in words):
        return "good"
    return "unknown"


# Slug words that mark a plain staple rather than a prepared or premium variant.
STAPLE_BONUS = ("great value", "value", "classic", "plain", "white", "fresh", "whole",
                "regular", "original", "premium", "all purpose")

# Unit price is the comparison primitive - it is legally mandated on grocery shelves
# in the EU, Australia (online retailers included) and ~17 US states. Almost no store
# publishes it in markup, so we parse size out of the title and compute it. Getting
# this wrong silently breaks every cross-store and cross-country comparison, so
# anything ambiguous is flagged rather than guessed.
MASS_TO_G = {"g": 1.0, "gram": 1.0, "grams": 1.0, "kg": 1000.0, "kilo": 1000.0,
             "kilogram": 1000.0, "oz": 28.3495, "lb": 453.592, "lbs": 453.592, "pound": 453.592}
VOL_TO_ML = {"ml": 1.0, "l": 1000.0, "liter": 1000.0, "litre": 1000.0, "liters": 1000.0,
             "litres": 1000.0, "floz": 29.5735, "gal": 3785.41, "qt": 946.353}
COUNT_UNITS = {"ct": 1, "count": 1, "pc": 1, "pcs": 1, "piece": 1, "pieces": 1,
               "s": 1, "dozen": 12, "doz": 12}
# "pack"/"pk" alone says how many bundles, not how much is in them.
AMBIGUOUS_UNITS = {"pack", "packs", "pk", "box", "case", "bundle", "set", "tray"}

_UOM = "|".join(sorted(
    set(MASS_TO_G) | set(VOL_TO_ML) | set(COUNT_UNITS) | AMBIGUOUS_UNITS, key=len, reverse=True))

RE_MULTIPACK = re.compile(rf"(\d+)\s*[x\u00d7]\s*(\d+(?:\.\d+)?)\s*-?\s*({_UOM})\b", re.I)
RE_RANGE = re.compile(rf"(\d+(?:\.\d+)?)\s*({_UOM})?\s*-\s*(\d+(?:\.\d+)?)\s*({_UOM})\b", re.I)
RE_FRACTION = re.compile(rf"(\d+)\s*/\s*(\d+)\s*-?\s*({_UOM})\b", re.I)
RE_FLOZ = re.compile(r"(\d+(?:\.\d+)?)\s*fl\.?\s*oz\b", re.I)
RE_PLAIN = re.compile(rf"(?<![\d/.])(\d+(?:\.\d+)?)\s*-?\s*({_UOM})\b", re.I)
RE_COUNT_APOS = re.compile(r"(\d+)\s*'?s\b")
RE_APPROX = re.compile(r"\bapprox\w*\b", re.I)


def _norm_uom(u: str) -> str:
    return (u or "").lower().replace(".", "").strip()


def to_base(value: float, uom: str) -> dict | None:
    """Convert to grams, millilitres or a count. None when the unit says nothing."""
    u = _norm_uom(uom)
    if u in MASS_TO_G:
        return {"quantity": round(value * MASS_TO_G[u], 4), "base_uom": "g"}
    if u in VOL_TO_ML:
        return {"quantity": round(value * VOL_TO_ML[u], 4), "base_uom": "ml"}
    if u in COUNT_UNITS:
        return {"quantity": round(value * COUNT_UNITS[u], 4), "base_uom": "count"}
    return None


def parse_size(text: str) -> dict | None:
    """Pull a size out of a product title.

    Handles multipacks ("12 x 2g" = 24 g), fractions ("1/4 Kg" = 250 g), ranges
    ("500g-600g" -> midpoint, flagged approximate), fluid ounces, and bare counts
    ("12's", "30pcs"). Returns None rather than guessing when the unit is a bundle
    of unknown contents, such as "6 Pack".
    """
    if not text:
        return None
    t = text.replace("\u00a0", " ")
    approx = bool(RE_APPROX.search(t))

    m = RE_MULTIPACK.search(t)
    if m:
        n, each, uom = int(m.group(1)), float(m.group(2)), m.group(3)
        base = to_base(n * each, uom)
        if base:
            return {"raw": m.group(0).strip(), "value": n * each, "uom": _norm_uom(uom),
                    "approximate": approx, "form": "multipack", **base}

    m = RE_FRACTION.search(t)
    if m:
        num, den, uom = float(m.group(1)), float(m.group(2)), m.group(3)
        if den:
            base = to_base(num / den, uom)
            if base:
                return {"raw": m.group(0).strip(), "value": num / den, "uom": _norm_uom(uom),
                        "approximate": approx, "form": "fraction", **base}

    m = RE_RANGE.search(t)
    if m:
        lo, hi, uom = float(m.group(1)), float(m.group(3)), m.group(4)
        mid = (lo + hi) / 2
        base = to_base(mid, uom)
        if base:
            return {"raw": m.group(0).strip(), "value": mid, "uom": _norm_uom(uom),
                    "approximate": True, "form": "range", **base}

    m = RE_FLOZ.search(t)
    if m:
        base = to_base(float(m.group(1)), "floz")
        if base:
            return {"raw": m.group(0).strip(), "value": float(m.group(1)), "uom": "floz",
                    "approximate": approx, "form": "volume", **base}

    for m in RE_PLAIN.finditer(t):
        value, uom = float(m.group(1)), _norm_uom(m.group(2))
        if uom in AMBIGUOUS_UNITS:
            continue
        base = to_base(value, uom)
        if base:
            return {"raw": m.group(0).strip(), "value": value, "uom": uom,
                    "approximate": approx, "form": "plain", **base}

    m = RE_COUNT_APOS.search(t)
    if m:
        n = float(m.group(1))
        return {"raw": m.group(0).strip(), "value": n, "uom": "count",
                "approximate": approx, "form": "count", "quantity": n, "base_uom": "count"}
    return None


def size_required(item: str) -> bool:
    """Items sold by weight or volume must state a size to be accepted.

    Groceries priced per gram or millilitre practically always name the pack size;
    apparel and homeware do not. That asymmetry kills a whole class of false hits
    that no keyword list catches - SM Markets' catalogue returns "Sugar Kids Girls'
    Klaris Pumps" for sugar and a tee in "Dark Coffee" for coffee, and neither
    carries a size. It costs nothing real either: without a size there is no unit
    price, so the pick could not have fed the index anyway.
    """
    return ITEMS[item]["normal_unit"] in ("g", "ml")


def size_is_plausible(item: str, size: dict | None) -> bool:
    """Is the pack big enough to be the staple rather than a snack of the same name?

    Pringles Sweet Onion is 100 g; onions are not. Piknik Potato is 55 g; potatoes
    are not. Brand blocklists never converge on this, but pack size separates the
    two cleanly. Only applied when a size actually parses.
    """
    floor = ITEMS[item].get("min_base_quantity")
    if not floor or not size:
        return True
    return size["quantity"] >= floor


def pick_is_usable(item: str, name: str, country: str) -> bool:
    """Every gate a candidate must clear before it counts as settled."""
    if not name_is_the_staple(item, name, country):
        return False
    size = parse_size(name)
    if size_required(item) and size is None:
        return False
    return unit_family_ok(item, size) and size_is_plausible(item, size)


def unit_family_ok(item: str, size: dict | None) -> bool:
    """Does the parsed size sit in the unit family this item is measured in?

    A principled check rather than another keyword: bottled water is measured in ml,
    so a 200 g pick is the wrong product whatever its title says. Catches a whole
    class of lookalikes that word lists never will. Unparseable sizes pass, because
    absence of evidence is handled separately.
    """
    if not size:
        return True
    return size["base_uom"] == ITEMS[item]["normal_unit"]


def unit_price(price: float | None, size: dict | None) -> dict | None:
    """Price per base unit, reported per kg / per litre / per item for readability."""
    if price is None or not size or not size.get("quantity"):
        return None
    base_uom, qty = size["base_uom"], size["quantity"]
    per_base = price / qty
    display = {"g": ("per_kg", per_base * 1000),
               "ml": ("per_litre", per_base * 1000),
               "count": ("per_item", per_base)}[base_uom]
    return {
        "per_base_unit": round(per_base, 6),
        "base_uom": base_uom,
        "basis": display[0],
        "value": round(display[1], 4),
        "approximate": bool(size.get("approximate")),
    }


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

    return extract_bare_html(html)


# Older and smaller storefronts carry no structured data at all - Kesar Grocery and
# MerryMart Wholesale between them hold nearly 12,000 products and expose none of it.
# Fall back to the page's own heading plus a price read from an element that says it
# is a price, rather than the first currency-looking number on the page.
RE_PRICE_ELEMENT = re.compile(
    r"""<[^>]*(?:class|id)\s*=\s*["'][^"']*\bprice\b[^"']*["'][^>]*>(.{0,200}?)</""",
    re.I | re.S,
)
RE_ANY_CURRENCY = re.compile(r"(?:[$₱]|PHP|USD|Rs\.?)\s?([0-9][0-9,]*(?:\.[0-9]{2})?)")
RE_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
RE_TITLE_TAG = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
RE_TAGS = re.compile(r"<[^>]+>")


def _text(fragment: str) -> str:
    import html as _html
    return _html.unescape(RE_TAGS.sub(" ", fragment or "")).strip()


def extract_bare_html(html: str) -> dict | None:
    if not html:
        return None
    name = None
    for rx in (RE_OG_TITLE, RE_H1, RE_TITLE_TAG):
        m = rx.search(html)
        if m:
            candidate = _text(m.group(1))
            if len(candidate) >= 3:
                name = re.sub(r"\s+", " ", candidate)[:150]
                break
    if not name:
        return None

    for frag in RE_PRICE_ELEMENT.findall(html)[:12]:
        m = RE_ANY_CURRENCY.search(_text(frag))
        if m:
            try:
                value = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            if value > 0:
                return {"name": name, "price": value, "currency": None, "via": "bare-html"}
    return None


def _tokens(text: str) -> set[str]:
    """Word tokens plus naive singulars, so "cubes" is caught by the term "cube"."""
    words = [w for w in re.split(r"[^a-z0-9]+", (text or "").lower()) if w]
    out = set(words)
    for w in words:
        if len(w) > 3 and w.endswith("es"):
            out.add(w[:-2])
        if len(w) > 3 and w.endswith("s"):
            out.add(w[:-1])
    return out


def term_hits(term: str, text: str, tokens: set[str]) -> bool:
    """Multi-word terms match as a phrase; single words match as tokens."""
    t = term.replace("-", " ").lower().strip()
    if " " in t:
        return f" {t} " in f" {re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()} "
    return t in tokens or (t.endswith("s") and t[:-1] in tokens)


def slug_words(url: str) -> str:
    seg = url.rstrip("/").rsplit("/", 1)[-1]
    return " " + re.sub(r"[^a-z0-9]+", " ", seg.lower()).strip() + " "


def name_is_the_staple(item: str, name: str, country: str = "PH") -> bool:
    """Does the product's own title agree that this is the basket staple?"""
    toks = _tokens(name)
    if not any(term_hits(m, name, toks) for m in must_terms(item, country)):
        return False
    if any(term_hits(x, name, toks) for x in exclude_terms(item)):
        return False
    if any(term_hits(g, name, toks) for g in NON_GROCERY):
        return False
    return True


def rank_candidates(item: str, urls: list[str], country: str = "PH") -> list[tuple[int, str]]:
    """Score how likely each URL is to be the plain staple for this basket item."""
    musts = must_terms(item, country)
    excl = exclude_terms(item)
    out = []
    for u in urls:
        w = slug_words(u)
        toks = _tokens(w)
        if not any(term_hits(m, w, toks) for m in musts):
            continue
        if any(term_hits(x, w, toks) for x in excl):
            continue
        if any(term_hits(g, w, toks) for g in NON_GROCERY):
            continue
        cat = category_verdict(item, u)
        if cat == "bad":
            continue
        score = 6 if cat == "good" else 0
        if parse_size(w):
            score += 4                      # a parsed size is what makes it comparable
        if any(b in w for b in STAPLE_BONUS):
            score += 2
        wordcount = len(w.split())
        score += 3 if wordcount <= 6 else 1 if wordcount <= 9 else 0   # plainer slug wins
        out.append((score, u))
    return sorted(out, key=lambda t: -t[0])


async def shopify_basket(base: str, country: str) -> dict:
    """Shopify's public suggest.json returns the store's own relevance ranking."""
    items: dict = {}
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=40) as c:
        for item, spec in ITEMS.items():
            best = None
            for term in must_terms(item, "PH") + must_terms(item, "US"):
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
                    if not pick_is_usable(item, h.get("title", ""), country):
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
                "size": parse_size(best["title"]),
                "status": "verified",
                "via": "shopify-search",
                "store_taxonomy": best.get("_taxonomy") or None,
            }
    return items


async def woocommerce_basket(base: str, country: str) -> dict:
    """WooCommerce Store API - the co-op and small-independent platform of choice."""
    items: dict = {}
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=40) as c:
        for item in ITEMS:
            best = None
            for term in must_terms(item, country):
                try:
                    r = await c.get(f"{base}/wp-json/wc/store/products",
                                    params={"search": term, "per_page": 20})
                    hits = r.json()
                except Exception as e:  # noqa: BLE001
                    items[item] = {"status": "error", "note": f"{type(e).__name__}: {e}"[:120]}
                    hits = []
                if not isinstance(hits, list):
                    hits = []
                for h in hits:
                    if not pick_is_usable(item, h.get("name", ""), country):
                        continue
                    best = h
                    break
                if best:
                    break
            if not best:
                items[item] = {"status": "not_found", "note": "store search returned no plain staple"}
                continue
            prices = best.get("prices") or {}
            raw = prices.get("price")
            minor = int(prices.get("currency_minor_unit", 2) or 0)
            try:
                price = float(raw) / (10 ** minor)
            except (TypeError, ValueError):
                price = None
            items[item] = {
                "url": best.get("permalink"), "name": best.get("name"),
                "price": price, "currency": prices.get("currency_code"),
                "size": parse_size(best.get("name", "")),
                "status": "verified" if price else "candidate_unverified",
                "via": "woocommerce-search",
            }
    return items


async def graphql_basket(country_cur: str) -> dict:
    """SM Markets ships a public Magento GraphQL endpoint - ask it directly."""
    items: dict = {}
    q = ('{{products(search:"{term}",pageSize:12){{items{{name url_key '
         'price_range{{minimum_price{{final_price{{value currency}}}}}}}}}}}}')
    async with httpx.AsyncClient(headers=HEADERS, timeout=40) as c:
        for item, spec in ITEMS.items():
            term = must_terms(item, country_cur)[0]
            try:
                r = await c.get("https://smmarkets.ph/graphql", params={"query": q.format(term=term)})
                nodes = r.json()["data"]["products"]["items"]
            except Exception as e:  # noqa: BLE001
                items[item] = {"status": "error", "note": f"{type(e).__name__}: {e}"[:120]}
                continue
            best = next((n for n in nodes
                         if pick_is_usable(item, n["name"], country_cur)), None)
            if not best:
                items[item] = {"status": "not_found", "note": f"{len(nodes)} results, none a plain staple"}
                continue
            fp = best["price_range"]["minimum_price"]["final_price"]
            items[item] = {
                "url": f"https://smmarkets.ph/{best['url_key']}.html",
                "name": best["name"],
                "price": float(fp["value"]),
                "currency": fp["currency"],
                "size": parse_size(best["name"]),
                "status": "verified",
                "via": "graphql",
            }
    return items


class UnlockerFetcher:
    """Fetcher-shaped, but routed through Bright Data's Web Unlocker.

    Same .get() signature as vet.Fetcher, so discover_urls and the basket builder
    work unchanged against sites that block plain HTTP - FreshDirect being the case
    that forced it. Cached like the free fetcher, because these calls cost money.
    """

    API = "https://api.brightdata.com/request"

    def __init__(self, client: httpx.AsyncClient, country: str, api_key: str,
                 zone: str = "cli_unlocker"):
        self.client, self.country, self.api_key, self.zone = client, country, api_key, zone
        self.calls = 0

    async def get(self, url: str, tag: str, timeout: float = 90.0,
                  max_body: int = 2_000_000) -> dict:
        cp = cache_path(url, f"ul-{tag}")
        if cp.exists():
            try:
                return json.loads(cp.read_text())
            except json.JSONDecodeError:
                pass
        try:
            r = await self.client.post(
                self.API,
                json={"zone": self.zone, "url": url, "format": "raw",
                      "country": self.country.lower()},
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=timeout,
            )
            out = {"url": url, "status": r.status_code, "final_url": url,
                   "bytes": len(r.content), "headers": {},
                   "body": r.text[:max_body], "error": None}
        except Exception as e:  # noqa: BLE001
            out = {"url": url, "status": 0, "final_url": url, "bytes": 0,
                   "headers": {}, "body": "", "error": f"{type(e).__name__}: {e}"[:200]}
        self.calls += 1
        cp.write_text(json.dumps(out))
        return out


async def build_store(entry: dict, cand: dict, f: Fetcher) -> dict:
    country = entry["country"]
    store = {
        "id": entry["id"], "name": entry["name"], "country": country,
        "structural_class": entry["structural_class"], "items": {}, "unresolved": [],
    }

    if entry.get("search_api") == "magento-graphql":
        store["items"] = await graphql_basket(country)
    elif entry.get("search_api") == "woocommerce":
        store["items"] = await woocommerce_basket(cand["homepage"].rstrip("/"), country)
    elif entry.get("search_api") == "shopify":
        store["items"] = await shopify_basket(cand["homepage"].rstrip("/"), country)
    else:
        disc = await discover_urls(cand, f)
        pool = disc["product_urls"] or disc["page_urls"]
        store["pool_size"] = len(pool)
        store["discovery"] = disc["via"]
        for item in ITEMS:
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
                if info and info["price"] > 0 and pick_is_usable(item, info["name"], country):
                    picked = {
                        "url": url, "name": info["name"], "price": info["price"],
                        "currency": info["currency"],
                        "size": parse_size(info["name"]) or parse_size(slug_words(url)),
                        "status": "verified", "via": info["via"],
                    }
                    break
            if picked is None:
                top = ranked[0][1]
                picked = {
                    "url": top, "name": None, "price": None, "currency": None,
                    "size": parse_size(slug_words(top)),
                    "status": "candidate_unverified",
                    "note": "URL selected from the sitemap but the page serves no price "
                            "over plain HTTP - confirm with a Studio run",
                }
            store["items"][item] = picked

    manual_doc = (json.loads((HERE / "manual-basket.json").read_text())
                  if (HERE / "manual-basket.json").exists() else {})
    ov = manual_doc.get("overrides", {}).get(entry["id"], {})

    # Items a store genuinely does not stock. Confirmed by hand, so the index knows
    # the gap is real rather than a scraper fault - and nothing keeps re-picking a
    # lookalike for a staple that is simply not sold there.
    for item, why in manual_doc.get("not_available", {}).get(entry["id"], {}).items():
        if item in ITEMS:
            store["items"][item] = {"status": "not_stocked", "note": why, "url": None}
    for item, fix in ov.items():
        store["items"][item] = {
            "url": fix["url"], "name": fix["name"], "price": None, "currency": None,
            "size": parse_size(fix["name"]), "status": "curated",
            "via": "manual", "why": fix["why"],
        }

    n = len(ITEMS)
    for item, rec in store["items"].items():
        spec = ITEMS[item]
        rec["target_size"] = spec["target_size"][country]
        rec["tier"] = spec["tier"]
        rec["label"] = spec["label"]
        rec["normal_unit"] = spec["normal_unit"]

        rec["unit_price"] = unit_price(rec.get("price"), rec.get("size"))
        if rec.get("size") is None and rec.get("url"):
            # No comparability without a size. Say so rather than publish a bare price.
            rec["size_unparsed"] = True
            rec.setdefault("note", "size could not be parsed from the product title, "
                                   "so no unit price - confirm the size by hand")
        if rec.get("status") not in ("verified", "curated"):
            store["unresolved"].append(item)

    store["verified_count"] = sum(
        1 for r in store["items"].values() if r.get("status") in ("verified", "curated"))
    store["chosen_url_count"] = sum(1 for r in store["items"].values() if r.get("url"))
    store["unit_priced_count"] = sum(1 for r in store["items"].values() if r.get("unit_price"))
    store["core_settled"] = sum(
        1 for k, r in store["items"].items()
        if k in CORE_ITEMS and r.get("status") in ("verified", "curated"))
    print(f"  {entry['id']:<24} settled {store['verified_count']:>2}/{n}  "
          f"core {store['core_settled']:>2}/{len(CORE_ITEMS)}  "
          f"urls {store['chosen_url_count']:>2}/{n}  "
          f"unit-priced {store['unit_priced_count']:>2}  "
          f"open: {','.join(store['unresolved'][:5]) or '-'}", flush=True)
    return store


def flag_unit_price_outliers(stores: list[dict], factor: float = 4.0) -> int:
    """Cross-check each item's unit price against its peers in the same country.

    A pick can be the right kind of product and still be the wrong listing - a case
    of 24 sold as one line, say. Nothing on the page reveals that, but the unit price
    standing far off its peers does. Flagged for review, never auto-dropped.
    """
    from statistics import median

    by_key: dict[tuple[str, str], list[tuple[float, dict]]] = {}
    for st in stores:
        for item, rec in st["items"].items():
            up = rec.get("unit_price")
            if up:
                by_key.setdefault((st["country"], item), []).append((up["value"], rec))

    flagged = 0
    for (country, item), rows in by_key.items():
        if len(rows) < 3:
            continue                      # too few peers for a median to mean anything
        med = median(v for v, _ in rows)
        if med <= 0:
            continue
        for value, rec in rows:
            ratio = value / med
            if ratio >= factor or ratio <= 1 / factor:
                rec["unit_price_outlier"] = {
                    "ratio_to_peer_median": round(ratio, 2),
                    "peer_median": round(med, 4),
                    "peers": len(rows),
                    "note": "far from the same item's unit price at other stores in this "
                            "country - likely a case, multipack or mis-picked listing",
                }
                flagged += 1
    return flagged


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--out", default=str(HERE / "basket-map.json"))
    args = ap.parse_args()

    lock = json.loads((HERE / "fleet.lock.json").read_text())
    cands = {c["id"]: c for c in json.loads((HERE / "candidates.json").read_text())["candidates"]}
    fleet = [e for e in lock["fleet"] if not args.ids or e["id"] in args.ids]

    print(f"building basket for {len(fleet)} locked stores\n", flush=True)
    api_key = os.environ.get("BRIGHTDATA_API_KEY")
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, http2=True) as client:
        free = Fetcher(client, use_cache=True)
        stores = []
        for e in fleet:
            if e.get("needs_unlocker"):
                if not api_key:
                    print(f"  {e['id']:<24} SKIPPED - needs the Unlocker but "
                          f"BRIGHTDATA_API_KEY is not set", flush=True)
                    continue
                fetcher = UnlockerFetcher(client, e["country"], api_key)
            else:
                fetcher = free
            stores.append(await build_store(e, cands[e["id"]], fetcher))

    outliers = flag_unit_price_outliers(stores)

    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "items": ITEMS,
        "stores": {s["id"]: s for s in stores},
        "totals": {
            "stores": len(stores),
            "verified_items": sum(s["verified_count"] for s in stores),
            "possible_items": len(stores) * len(ITEMS),
            "unit_price_outliers": outliers,
            "core_items": len(CORE_ITEMS),
            "tracked_items": len(ITEMS),
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
    print(f"\nverified {t['verified_items']}/{t['possible_items']} store-item pairs; "
          f"{outliers} unit-price outlier(s) flagged for review")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
