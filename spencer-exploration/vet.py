# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx[http2]"]
# ///
"""Tier-0 site vetting: free HTTP probes, no Bright Data credits.

Classifies every candidate as server_rendered / spa_empty / blocked, harvests
sitemaps, and maps the canonical basket items to real product URLs.

Usage:
    uv run spencer-exploration/vet.py                  # probe all candidates
    uv run spencer-exploration/vet.py --only ph        # country filter
    uv run spencer-exploration/vet.py --ids ph-landers us-aldi
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from collections import defaultdict
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

HERE = Path(__file__).parent
RAW = HERE / "raw"
RAW.mkdir(exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

GLOBAL_CONCURRENCY = 10
PER_HOST_DELAY = 1.2  # seconds between requests to the same host

# --- classification signals -------------------------------------------------

CHALLENGE_MARKERS = (
    "just a moment",
    "cf-browser-verification",
    "checking your browser",
    "attention required",
    "access denied",
    "request unsuccessful",
    "incapsula incident",
    "datadome",
    "px-captcha",
    "enable javascript and cookies to continue",
    "are you a human",
)

RE_JSONLD_PRODUCT = re.compile(r'"@type"\s*:\s*"(?:Product|Offer|AggregateOffer)"', re.I)
RE_JSONLD_PRICE = re.compile(r'"(?:price|lowPrice|highPrice)"\s*:\s*"?\d', re.I)
RE_MICRODATA = re.compile(r'itemprop\s*=\s*["\'](?:price|lowPrice)["\']', re.I)
RE_META_PRICE = re.compile(r'property\s*=\s*["\'](?:product:price:amount|og:price:amount)["\']', re.I)
# A price is 2+ digits ("PHP 378") or has explicit cents ("$4.49"). One-digit
# amounts like "$5" appear too often in body copy to be a reliable signal.
RE_CURRENCY = re.compile(
    r"(?:[$₱]|PHP|USD)\s?(?:\d{1,3}(?:,\d{3})+(?:\.\d{2})?"   # 1,234 / 1,234.56
    r"|\d{2,}(?:\.\d{2})?"                                      # 378 / 378.00
    r"|\d\.\d{2})"                                              # 4.49
)
RE_EMBEDDED_STATE = re.compile(
    r"__NEXT_DATA__|window\.__INITIAL_STATE__|window\.__NUXT__|__APOLLO_STATE__"
    r"|window\.__remixContext|self\.__next_f",
    re.I,
)
RE_API_HINT = re.compile(r'["\'](/(?:api|graphql|wp-json|rest)/[a-z0-9_\-/]+)["\']', re.I)

WAF_HEADER_KEYS = ("cf-ray", "x-akamai-transformed", "x-iinfo", "x-cdn", "x-sucuri-id", "x-amz-cf-id")
WAF_COOKIE_KEYS = ("__cf_bm", "cf_clearance", "incap_ses", "visid_incap", "datadome", "ak_bmsc", "bm_sv", "_px")

# --- basket ------------------------------------------------------------------

BASKET = {
    "eggs": ["egg", "eggs", "itlog"],
    "milk": ["milk", "gatas"],
    "bread": ["bread", "loaf", "tinapay", "pandesal"],
    "rice": ["rice", "bigas"],
    "coffee": ["coffee", "kape"],
    "sugar": ["sugar", "asukal"],
    "chicken": ["chicken", "manok"],
    "cooking_oil": ["cooking oil", "canola oil", "vegetable oil", "palm oil", "olive oil", "corn oil", "mantika"],
    "pasta": ["pasta", "spaghetti", "macaroni", "penne"],
    "bananas": ["banana", "bananas", "saging"],
}

# Slug tokens that mean the match is not the grocery staple we are after:
# a toy "surprise egg", a "baby lotion milk", a "coffee table".
NON_GROCERY = (
    "toy", "toys", "plush", "doll", "figure", "lego", "puzzle", "game",
    "shampoo", "lotion", "soap", "serum", "cream", "perfume", "cologne", "deodorant",
    "detergent", "bleach", "fabric", "cleaner", "sanitizer", "wipes", "diaper",
    "tissue", "napkin", "candle", "gift", "book", "shirt", "apparel", "shoes",
    "table", "chair", "mug", "cup", "bowl", "plate", "maker", "machine", "grinder",
    "supplement", "capsule", "tablet", "softgel", "vitamin", "extract", "powder-blend",
    "scented", "fragrance", "body-wash", "face", "hair", "nail", "makeup", "lipstick",
    "pet", "dog", "cat", "litter", "feed",
    "flavor", "flavour", "syrup", "suspension", "drops", "lozenge",
    "cleansing", "cleanser", "micellar", "moisturizer", "conditioner",
    "scrub", "mask", "toner", "balm", "wax", "spray",
    # pharmacy dosage forms - PH drugstores sell banana-flavoured medicine
    "granules", "solution", "effervescent", "ampule", "vial", "ointment", "sachet-rx",
    # collectible/novelty wording - a "surprise egg" is a toy
    "surprise", "collectible", "figurine", "blindbag", "keychain",
)


def _slug_tokens(url: str) -> str:
    """Last path segment, punctuation flattened to spaces, for word-boundary matching."""
    path = urlparse(url).path.lower().rstrip("/")
    seg = path.rsplit("/", 1)[-1] if "/" in path else path
    return " " + re.sub(r"[^a-z0-9]+", " ", seg).strip() + " "


def basket_match(url: str) -> str | None:
    """Which canonical basket item this product URL is, if any.

    First match wins, in BASKET declaration order, so a slug naming two items
    resolves deterministically rather than by dict iteration luck.
    """
    slug = _slug_tokens(url)
    if any(f" {w.replace('-', ' ')} " in slug for w in NON_GROCERY):
        return None
    for item, kws in BASKET.items():
        for kw in kws:
            if f" {kw} " in slug:
                return item
    return None


def cache_path(url: str, tag: str) -> Path:
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    host = re.sub(r"[^a-z0-9]+", "-", urlparse(url).netloc.lower())[:40]
    return RAW / f"{host}__{tag}__{h}.txt"


class Fetcher:
    """Cached, rate-limited, per-host-serialised HTTP GET."""

    def __init__(self, client: httpx.AsyncClient, use_cache: bool = True):
        self.client = client
        self.use_cache = use_cache
        self._host_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._last_hit: dict[str, float] = {}

    async def get(self, url: str, tag: str, timeout: float = 20.0, max_body: int = 400_000) -> dict:
        cp = cache_path(url, tag)
        if self.use_cache and cp.exists():
            try:
                return json.loads(cp.read_text())
            except json.JSONDecodeError:
                pass

        host = urlparse(url).netloc
        async with self._host_locks[host]:
            gap = time.monotonic() - self._last_hit.get(host, 0)
            if gap < PER_HOST_DELAY:
                await asyncio.sleep(PER_HOST_DELAY - gap)
            out = await self._raw(url, timeout, max_body)
            self._last_hit[host] = time.monotonic()

        cp.write_text(json.dumps(out))
        return out

    async def _raw(self, url: str, timeout: float, max_body: int) -> dict:
        try:
            r = await self.client.get(url, timeout=timeout)
            body = r.text
            return {
                "url": url,
                "status": r.status_code,
                "final_url": str(r.url),
                "bytes": len(r.content),
                "headers": {k.lower(): v for k, v in r.headers.items()},
                "body": body[:max_body],
                "error": None,
            }
        except Exception as e:  # noqa: BLE001 - a failed probe is data, not a crash
            return {
                "url": url,
                "status": 0,
                "final_url": url,
                "bytes": 0,
                "headers": {},
                "body": "",
                "error": f"{type(e).__name__}: {e}"[:200],
            }


def waf_fingerprint(headers: dict) -> list[str]:
    found = []
    for k in WAF_HEADER_KEYS:
        if k in headers:
            found.append(k)
    server = (headers.get("server") or "").lower()
    for name in ("cloudflare", "akamai", "awselb", "nginx", "cloudfront", "imperva", "varnish"):
        if name in server:
            found.append(f"server:{name}")
    cookies = headers.get("set-cookie", "")
    for c in WAF_COOKIE_KEYS:
        if c in cookies:
            found.append(f"cookie:{c}")
    return sorted(set(found))


def classify(resp: dict) -> dict:
    """server_rendered | spa_empty | blocked, plus the evidence behind it."""
    body = resp.get("body") or ""
    low = body[:200_000].lower()
    status = resp["status"]

    challenge = [m for m in CHALLENGE_MARKERS if m in low]
    if status in (0, 401, 403, 405, 406, 429, 451, 503) or challenge:
        return {
            "class": "blocked",
            "reason": resp.get("error") or f"http {status}" + (f" challenge:{challenge[0]}" if challenge else ""),
            "signals": {},
        }
    if status >= 400:
        return {"class": "blocked", "reason": f"http {status}", "signals": {}}

    prices = set(RE_CURRENCY.findall(body))
    sig = {
        "jsonld_product": bool(RE_JSONLD_PRODUCT.search(body)),
        "jsonld_price": bool(RE_JSONLD_PRICE.search(body)),
        "microdata_price": bool(RE_MICRODATA.search(body)),
        "meta_price": bool(RE_META_PRICE.search(body)),
        "distinct_currency_strings": len(prices),
        "embedded_state": bool(RE_EMBEDDED_STATE.search(body)),
        "api_paths": sorted(set(RE_API_HINT.findall(body)))[:5],
        "bytes": resp["bytes"],
    }
    structured = sig["jsonld_price"] or sig["microdata_price"] or sig["meta_price"]
    if structured or sig["distinct_currency_strings"] >= 3:
        return {"class": "server_rendered", "reason": "price present in raw HTML", "signals": sig}
    return {"class": "spa_empty", "reason": "200 but no price in raw HTML", "signals": sig}


def structural_class(sig: dict) -> str:
    """The extraction shape a scraper would have to target.

    "spa-opaque" and "unknown" are different findings: the first means we read the
    page and it carries no price in any form, the second means we never saw a page.
    """
    if sig.get("jsonld_price"):
        return "json-ld"
    if sig.get("microdata_price") or sig.get("meta_price"):
        return "microdata"
    if sig.get("embedded_state"):
        return "spa-with-state"
    if sig.get("distinct_currency_strings", 0) >= 3:
        return "bare-html"
    return "spa-opaque" if sig else "unknown"


def parse_robots(text: str) -> dict:
    """Parse the User-agent: * group. Groups are delimited by non-agent lines."""
    sitemaps: list[str] = []
    disallows: list[str] = []
    allows: list[str] = []
    in_star = False
    prev_was_agent = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip().lower(), val.strip()
        if key == "sitemap":
            sitemaps.append(val)
        elif key == "user-agent":
            # consecutive agent lines share one group, so OR them together
            in_star = (val == "*") or (in_star and prev_was_agent)
            prev_was_agent = True
            continue
        elif in_star and val:
            if key == "disallow":
                disallows.append(val)
            elif key == "allow":
                allows.append(val)
        prev_was_agent = False
    return {"sitemaps": sitemaps, "disallow_star": disallows, "allow_star": allows}


def _rule_to_re(rule: str) -> re.Pattern:
    """robots.txt path rule -> anchored regex. '*' is any run, trailing '$' anchors."""
    anchored_end = rule.endswith("$")
    body = rule[:-1] if anchored_end else rule
    pat = "".join(".*" if ch == "*" else re.escape(ch) for ch in body)
    return re.compile("^" + pat + ("$" if anchored_end else ""))


def _match_len(path: str, rules: list[str]) -> int:
    """Length of the longest rule matching path, or -1 if none match."""
    best = -1
    for rule in rules:
        try:
            if _rule_to_re(rule).match(path):
                best = max(best, len(rule))
        except re.error:
            continue
    return best


def robots_blocks(path: str, disallows: list[str], allows: list[str] | None = None) -> bool:
    """True if path is disallowed. Most specific rule wins; Allow breaks ties."""
    d = _match_len(path, disallows)
    if d < 0:
        return False
    a = _match_len(path, allows or [])
    return d > a


def parse_sitemap(text: str) -> tuple[list[str], list[str]]:
    """Return (page_urls, nested_sitemap_urls)."""
    stripped = text.lstrip()
    if stripped.startswith("<"):
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", text, re.I)
        if re.search(r"<sitemapindex", text, re.I):
            return [], locs
        return locs, []
    urls = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("http")]
    return urls, []


# Path segments that mean a URL is editorial or navigational, never a product page.
NON_PRODUCT_PATHS = (
    "recipe", "recipes", "healthy-living", "article", "articles", "blog", "news",
    "story", "stories", "guide", "guides", "event", "events", "career", "careers",
    "about", "contact", "faq", "help", "support", "policy", "privacy", "terms",
    "store-locator", "stores", "locations", "branches", "weekly-ad", "coupon",
    "coupons", "gift-card", "giftcard", "category", "categories", "collections",
    "container", "brand", "brands", "tag", "tags", "search", "account", "login",
    "cart", "checkout", "sitemap", "page", "pages", "author", "press", "media",
    "community", "recall", "recalls", "spotlight", "promo", "promos", "sale",
    "deals", "flyer", "circular", "careers", "info", "landing",
    "home-page", "homepage", "assets", "static", "uploads", "banners",
    "inspiration", "ideas", "learn", "discover", "explore", "meal", "menu",
)

# Slug fragments that mark a marketing asset rather than a product. Grocery Outlet
# was scored server-rendered off "012126_eggs_websitebanner_", a homepage image.
RE_ASSET_SLUG = re.compile(r"banner|logo|hero|thumbnail|placeholder|sprite|favicon", re.I)

# Words that make a slug editorial wherever they appear, unlike softer terms such
# as "sale" or "info" which can show up inside a real product name.
EDITORIAL_WORDS = {
    "recipe", "recipes", "article", "articles", "blog", "news", "guide", "guides",
    "inspiration", "ideas", "story", "stories",
}

RE_UNIT = re.compile(
    r"\b\d+(?:\.\d+)?\s?-?\s?(?:oz|lb|lbs|ml|l|g|kg|ct|pk|pack|packs|dozen|count|gal|qt|pcs|pc)\b"
)


def product_score(url: str, hints: list[str]) -> int:
    """How product-like a URL looks. Negative means: do not probe this."""
    parsed = urlparse(url)
    path = parsed.path.lower()
    if not path or path == "/":
        return -100
    if re.search(r"\.(jpg|jpeg|png|gif|pdf|css|js|webp|svg|xml|zip)$", path):
        return -100
    segs = [s for s in path.strip("/").split("/") if s]
    if not segs:
        return -100
    # Match on words inside a segment, not the whole segment: The Fresh Market files
    # editorial under "/inspiration/recipe-and-ideas/", which whole-segment equality
    # let straight through.
    def seg_words(seg: str) -> set[str]:
        return {w for w in re.split(r"[^a-z0-9]+", seg) if w}

    non_product = set(NON_PRODUCT_PATHS)
    if any(seg in non_product or seg_words(seg) & non_product for seg in segs[:-1]):
        return -100
    # The final segment is the product slug, so only unambiguous editorial words
    # disqualify it - a staple can legitimately be called "sale-rice-5kg".
    if segs[-1] in non_product or seg_words(segs[-1]) & EDITORIAL_WORDS:
        return -100

    if RE_ASSET_SLUG.search(segs[-1]):
        return -100

    slug = re.sub(r"[^a-z0-9]+", " ", segs[-1])
    score = 0
    if any(h and h != "/" and h in url for h in hints):
        score += 3
    if RE_UNIT.search(slug):
        score += 3          # "canola oil 1 5l" - a size token is the strongest product tell
    if re.search(r"\d{3,}", segs[-1]):
        score += 1          # trailing SKU/id
    if len(slug) >= 20:
        score += 2
    elif len(slug) >= 12:
        score += 1
    if len(segs) >= 2:
        score += 1
    return score


def basket_map(urls: list[str]) -> dict:
    """Map canonical basket items to real product URLs found in a sitemap."""
    out: dict[str, dict] = {}
    for u in urls:
        item = basket_match(u)
        if not item:
            continue
        rec = out.setdefault(item, {"count": 0, "samples": []})
        rec["count"] += 1
        if len(rec["samples"]) < 3:
            rec["samples"].append(u)
    for rec in out.values():
        rec["sample"] = rec["samples"][0]
    return out


def internal_links(html: str, base: str) -> list[str]:
    hrefs = re.findall(r'href\s*=\s*["\']([^"\'#]+)["\']', html, re.I)
    host = urlparse(base).netloc
    out = []
    for h in hrefs:
        u = urljoin(base, h).split("?")[0]
        if urlparse(u).netloc == host:
            out.append(u)
    return list(dict.fromkeys(out))


# Category slugs worth crawling first when a site has no sitemap - they are where
# the basket lives, so the sampled URL pool stays comparable to a sitemap-derived one.
BASKET_CATEGORY_HINTS = (
    "rice", "grain", "dairy", "milk", "egg", "bread", "bakery", "baking", "coffee",
    "tea", "beverage", "sugar", "sweetener", "cooking", "oil", "condiment", "pasta",
    "noodle", "meat", "poultry", "chicken", "produce", "fruit", "vegetable", "grocery",
    "staple", "pantry", "canned", "breakfast",
)


async def crawl_for_products(
    f: "Fetcher", home: str, hints: list[str], max_categories: int = 8
) -> tuple[list[str], list[str]]:
    """Free fallback when a site publishes no sitemap: homepage -> categories -> products.

    MerryMart Wholesale is the motivating case - fully server-rendered PHP prices but
    no sitemap at all. Crawling only one category also skews basket coverage, so this
    walks several basket-relevant categories to keep the sample comparable to a
    sitemap-derived one.
    """
    hp = await f.get(home, "home")
    if hp["status"] != 200 or not hp["body"]:
        return [], []
    links = internal_links(hp["body"], home)
    products = [u for u in links if product_score(u, hints) >= 3]

    cats = [u for u in links if re.search(r"/(categor|collection|shop|department|aisle)", u, re.I)]
    # basket-relevant categories first, then whatever else is left
    cats.sort(key=lambda u: 0 if any(k in u.lower() for k in BASKET_CATEGORY_HINTS) else 1)

    visited: list[str] = []
    for c in cats[:max_categories]:
        if len(products) >= 400:
            break
        r = await f.get(c, "category", timeout=30)
        visited.append(c)
        if r["status"] != 200:
            continue
        products.extend(u for u in internal_links(r["body"], c) if product_score(u, hints) >= 3)

    return list(dict.fromkeys(products)), visited


async def discover_urls(cand: dict, f: Fetcher) -> dict:
    """Find a site's page and product URLs: robots -> sitemaps -> crawl fallback.

    Shared by the tier-0 probe and the basket builder so both see the same pool.
    """
    home = cand["homepage"]
    base = f"{urlparse(home).scheme}://{urlparse(home).netloc}"
    hints = cand.get("product_hint", [])

    rb = await f.get(urljoin(base, "/robots.txt"), "robots", timeout=12)
    robots = {"fetched": rb["status"] == 200, "sitemaps": [], "disallow_star": [], "allow_star": []}
    if rb["status"] == 200 and rb["body"].strip() and "<html" not in rb["body"][:300].lower():
        robots.update(parse_robots(rb["body"]))

    sm_candidates = list(robots["sitemaps"])
    for guess in ("/sitemap.xml", "/sitemap_index.xml", "/sitemap.txt", "/sitemap-index.xml"):
        sm_candidates.append(urljoin(base, guess))

    page_urls: list[str] = []
    tried, nested_done = [], 0
    for sm in sm_candidates[:6]:
        if len(page_urls) > 3000:
            break
        r = await f.get(sm, "sitemap", timeout=45, max_body=6_000_000)
        tried.append({"url": sm, "status": r["status"], "bytes": r["bytes"]})
        if r["status"] != 200 or not r["body"].strip():
            continue
        pages, nested = parse_sitemap(r["body"])
        page_urls.extend(pages)
        for n in nested[:4]:
            if nested_done >= 4:
                break
            nr = await f.get(n, "sitemap", timeout=45, max_body=6_000_000)
            nested_done += 1
            tried.append({"url": n, "status": nr["status"], "bytes": nr["bytes"], "nested": True})
            if nr["status"] == 200:
                p2, _ = parse_sitemap(nr["body"])
                page_urls.extend(p2)
        if page_urls:
            break

    page_urls = list(dict.fromkeys(page_urls))
    scored = ((product_score(u, hints), u) for u in page_urls)
    product_urls = [u for sc, u in sorted((t for t in scored if t[0] >= 3), key=lambda t: -t[0])]

    crawled: list[str] = []
    if not product_urls:
        crawl_found, crawled = await crawl_for_products(f, home, hints)
        if crawl_found:
            product_urls = [u for sc, u in sorted(
                ((product_score(u, hints), u) for u in crawl_found), key=lambda t: -t[0]
            )]
            page_urls = page_urls or product_urls

    if crawled:
        via = "crawl" if product_urls else "none"
    elif page_urls:
        via = "sitemap"
    else:
        via = "none"

    return {
        "robots": robots,
        "page_urls": page_urls,
        "product_urls": product_urls,
        "tried": tried,
        "crawled": crawled,
        "via": via,
    }


async def probe_site(cand: dict, f: Fetcher, sem: asyncio.Semaphore) -> dict:
    async with sem:
        home = cand["homepage"]
        rec: dict = {
            "id": cand["id"],
            "name": cand["name"],
            "country": cand["country"],
            "vertical": cand["vertical"],
            "homepage": home,
            "why": cand["why"],
        }

        hp = await f.get(home, "home")
        rec["home"] = {
            "status": hp["status"],
            "final_url": hp["final_url"],
            "bytes": hp["bytes"],
            "error": hp["error"],
            "waf": waf_fingerprint(hp["headers"]),
        }
        rec["home_class"] = classify(hp)["class"]

        disc = await discover_urls(cand, f)
        robots = disc["robots"]
        page_urls, product_urls = disc["page_urls"], disc["product_urls"]
        tried, crawled, via = disc["tried"], disc["crawled"], disc["via"]
        rec["robots"] = robots
        rec["discovery"] = {"via": via, "categories_crawled": crawled}
        rec["sitemap"] = {
            "tried": tried,
            "total_urls": len(page_urls),
            "product_like_urls": len(product_urls),
        }
        rec["basket"] = basket_map(product_urls or page_urls)
        rec["basket_coverage"] = len(rec["basket"])

        # product probes: prefer basket-matched URLs so the probe proves a real basket item
        picks: list[str] = []
        for item in rec["basket"].values():
            if item["sample"] not in picks:
                picks.append(item["sample"])
            if len(picks) >= 2:
                break
        for u in product_urls:
            if len(picks) >= 3:
                break
            if u not in picks:
                picks.append(u)

        probes = []
        for u in picks[:3]:
            pr = await f.get(u, "product", timeout=25)
            c = classify(pr)
            probes.append(
                {
                    "url": u,
                    "status": pr["status"],
                    "bytes": pr["bytes"],
                    "class": c["class"],
                    "reason": c["reason"],
                    "signals": c["signals"],
                }
            )
        rec["product_probes"] = probes

        if probes:
            classes = [p["class"] for p in probes]
            rec["verdict_class"] = (
                "server_rendered" if "server_rendered" in classes
                else "spa_empty" if "spa_empty" in classes
                else "blocked"
            )
            best = next((p for p in probes if p["class"] == rec["verdict_class"]), probes[0])
            rec["structural_class"] = structural_class(best.get("signals") or {})
            rec["evidence_url"] = best["url"]
        else:
            rec["verdict_class"] = "blocked" if rec["home_class"] == "blocked" else "no_product_urls"
            rec["structural_class"] = "unknown"
            rec["evidence_url"] = None

        # robots gate on the probed path
        path = urlparse(rec["evidence_url"]).path if rec["evidence_url"] else "/"
        rec["robots_allows_product"] = not robots_blocks(
            path, robots["disallow_star"], robots.get("allow_star", [])
        )

        print(
            f"  {cand['id']:<24} {rec['verdict_class']:<16} "
            f"basket={rec['basket_coverage']}/10 sitemap={rec['sitemap']['total_urls']:<6} "
            f"struct={rec['structural_class']}",
            flush=True,
        )
        return rec


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="country filter: US or PH")
    ap.add_argument("--ids", nargs="*", help="probe only these candidate ids")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--insecure", action="store_true",
                    help="skip TLS verification (default: verify, and record cert failures "
                         "as blocked - a broken cert is a real finding about a site)")
    ap.add_argument("--out", default=str(HERE / "tier0.json"))
    ap.add_argument("--candidates", default=str(HERE / "candidates.json"))
    args = ap.parse_args()

    cands = json.loads(Path(args.candidates).read_text())["candidates"]
    if args.only:
        cands = [c for c in cands if c["country"].upper() == args.only.upper()]
    if args.ids:
        cands = [c for c in cands if c["id"] in args.ids]

    print(f"tier-0 probing {len(cands)} candidates (cache={'off' if args.no_cache else 'on'})\n", flush=True)
    sem = asyncio.Semaphore(GLOBAL_CONCURRENCY)
    limits = httpx.Limits(max_connections=40, max_keepalive_connections=10)
    async with httpx.AsyncClient(
        headers=HEADERS, follow_redirects=True, limits=limits,
        verify=not args.insecure, http2=True,
    ) as client:
        f = Fetcher(client, use_cache=not args.no_cache)
        results = await asyncio.gather(*(probe_site(c, f, sem) for c in cands), return_exceptions=True)

    ok, failed = [], []
    for c, r in zip(cands, results):
        if isinstance(r, BaseException):
            failed.append({"id": c["id"], "error": f"{type(r).__name__}: {r}"})
        else:
            ok.append(r)

    Path(args.out).write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tls_verified": not args.insecure,
        "candidates_probed": len(cands),
        "results": ok,
        "harness_failures": failed,
    }, indent=2))

    tally: dict[str, int] = defaultdict(int)
    for r in ok:
        tally[r["verdict_class"]] += 1
    print("\n--- tier-0 summary ---")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<18} {v}")
    if failed:
        print(f"  HARNESS FAILURES  {len(failed)}: {[x['id'] for x in failed]}")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
