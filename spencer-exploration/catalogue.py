# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx[http2]"]
# ///
"""Bulk catalogue puller: every product a store sells, priced.

The basket pins ~20 products per store. This pulls the whole catalogue behind them,
which is what makes the product a price tracker rather than a basket index. The two
compose: the basket becomes a selection over these rows.

Per-store method and page ceiling come from the `catalogue` block in fleet.lock.json.
Ceilings are hard stops checked before each fetch, so a runaway crawl is impossible by
construction - the failure mode that once produced 4,470 unintended rows.

Usage:
    uv run spencer-exploration/catalogue.py --transport http
    uv run spencer-exploration/catalogue.py --ids ph-ever --transport http
    uv run spencer-exploration/catalogue.py --ids ph-ever --max-pages 2   # override
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

HERE = Path(__file__).parent
OUT = HERE / "catalogue"
OUT.mkdir(exist_ok=True)
sys.path.insert(0, str(HERE))

from vet import (  # noqa: E402
    HEADERS,
    Fetcher,
    discover_urls,
    parse_sitemap,
    product_score,
)
# Catalogue payloads are far larger than page fetches - Shop Gaisano's products.json
# exceeds the default cap by an order of magnitude. Truncation shows up as a store
# returning zero rows, not as an error, so the cap has to be raised explicitly.
API_MAX_BODY = 32_000_000

from basket import (  # noqa: E402
    UnlockerFetcher,
    extract_product,
    parse_size,
    unit_price,
)

import store  # noqa: E402

def NOW() -> str:
    """UTC timestamp with a Z suffix.

    Zod's .datetime() rejects a "+00:00" offset unless offset:true is set, and the
    fleet contract does not set it - so an offset-form timestamp fails validation on
    every row. Found by running catalogue rows through the repo's own validateRun.
    """
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# Shopify's products.json carries no currency field at all. Country is already a
# first-class dimension, so derive it from there and let a source-provided value win.
COUNTRY_CURRENCY = {"PH": "PHP", "US": "USD"}


def row(store_id: str, country: str, *, product_key, name, price, currency,
        url, in_stock=True, category=None, raw_size=None, source="puller") -> dict:
    """One catalogue row, shaped to the fleet output contract plus tracker fields.

    `source` records which transport actually produced this row. Studio is the primary
    collector; when a collector fails the puller covers for it, and the row says so
    rather than the substitution being invisible.
    """
    size = parse_size(raw_size or name or "")
    return {
        "store_id": store_id,
        "country": country,
        "product_key": str(product_key),
        "name": (name or "").strip()[:200],
        "price": price,
        "currency": currency or COUNTRY_CURRENCY.get(country),
        "unit": (size or {}).get("raw"),
        "in_stock": bool(in_stock),
        "url": url,
        "observed_at": NOW(),
        "category": category,
        "size": size,
        "unit_price": unit_price(price, size),
        "source": source,
    }


# --- strategies ---------------------------------------------------------------

async def pull_shopify(entry: dict, cfg: dict, fetch, max_pages: int) -> tuple[list[dict], int]:
    """Shopify publishes its whole catalogue at /products.json, 250 per page."""
    base = cfg["endpoint"]
    site = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    rows, pages = [], 0
    for page in range(1, max_pages + 1):
        r = await fetch(f"{base}?limit=250&page={page}", f"cat-p{page}",
                        max_body=API_MAX_BODY)
        pages += 1
        if r["status"] != 200:
            break
        try:
            products = json.loads(r["body"]).get("products", [])
        except (json.JSONDecodeError, ValueError):
            break
        if not products:
            break
        for p in products:
            variants = p.get("variants") or [{}]
            v = variants[0]
            price = None
            try:
                price = float(v.get("price"))
            except (TypeError, ValueError):
                pass
            if price is None or price <= 0:
                continue
            tags = p.get("tags") or []
            rows.append(row(
                entry["id"], entry["country"],
                product_key=p.get("id"), name=p.get("title"), price=price, currency=None,
                url=f"{site}/products/{p.get('handle')}",
                in_stock=bool(v.get("available", True)),
                category=", ".join(tags) if isinstance(tags, list) else str(tags),
            ))
        if len(products) < 250:
            break            # natural end of catalogue, ahead of the ceiling
    return rows, pages


# Magento rejects an open price filter, but its category tree is queryable and gives
# real category labels for free. SM Markets exposes 60,099 products this way.
MAGENTO_CATEGORIES = "{categories(filters:{}){items{uid name product_count}}}"
MAGENTO_PRODUCTS = (
    '{{products(filter:{{category_uid:{{eq:"{uid}"}}}},pageSize:100,currentPage:{page})'
    '{{total_count items{{name sku url_key '
    'price_range{{minimum_price{{final_price{{value currency}}}}}}}}}}}}'
)


async def _gql(fetch, base: str, query: str, tag: str) -> dict | None:
    url = f"{base}?query={httpx.QueryParams({'q': query})['q']}"
    r = await fetch(url, tag, max_body=API_MAX_BODY)
    if r["status"] != 200:
        return None
    try:
        return json.loads(r["body"]).get("data")
    except (json.JSONDecodeError, ValueError):
        return None


async def pull_magento(entry: dict, cfg: dict, fetch, max_pages: int) -> tuple[list[dict], int]:
    """Walk the category tree, then page products within each category."""
    base = cfg["endpoint"]
    site = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    rows, pages = [], 0

    data = await _gql(fetch, base, MAGENTO_CATEGORIES, "cat-tree")
    pages += 1
    cats = [c for c in ((data or {}).get("categories") or {}).get("items", [])
            if (c.get("product_count") or 0) > 0 and c.get("name") != "Default Category"]
    if cfg.get("category_priority"):
        cats = rank_by_category([c["name"] for c in cats], cfg["category_priority"]) and cats
    cats.sort(key=lambda c: -(c.get("product_count") or 0))

    for cat in cats:
        if pages >= max_pages:
            break
        for page in range(1, 100):
            if pages >= max_pages:
                break
            data = await _gql(fetch, base,
                              MAGENTO_PRODUCTS.format(uid=cat["uid"], page=page),
                              f"cat-{cat['uid']}-p{page}")
            pages += 1
            items = ((data or {}).get("products") or {}).get("items") or []
            if not items:
                break
            for it in items:
                try:
                    fp = it["price_range"]["minimum_price"]["final_price"]
                    price = float(fp["value"])
                except (KeyError, TypeError, ValueError):
                    continue
                if price <= 0:
                    continue
                rows.append(row(
                    entry["id"], entry["country"],
                    product_key=it.get("sku"), name=it.get("name"), price=price,
                    currency=fp.get("currency"), url=f"{site}/{it.get('url_key')}.html",
                    category=cat.get("name"),
                ))
            if len(items) < 100:
                break
    return rows, pages


def rank_by_category(urls: list[str], priority: list[str]) -> list[str]:
    """Bounded pulls spend their budget on the categories the basket lives in."""
    def key(u: str) -> int:
        low = u.lower()
        for i, cat in enumerate(priority):
            if cat in low:
                return i
        return len(priority)
    return sorted(urls, key=key)


async def pull_sitemap(entry: dict, cfg: dict, fetch, max_pages: int,
                       cand: dict, f: Fetcher) -> tuple[list[dict], int]:
    """One fetch per product. Used where no bulk endpoint exists."""
    disc = await discover_urls(cand, f)
    urls = disc["product_urls"] or disc["page_urls"]
    if cfg.get("category_priority"):
        urls = rank_by_category(urls, cfg["category_priority"])
    urls = urls[:max_pages]

    rows, pages = [], 0
    for u in urls:
        r = await fetch(u, "cat")
        pages += 1
        if r["status"] != 200:
            continue
        info = extract_product(r["body"])
        if not info or not info.get("price"):
            continue
        rows.append(row(
            entry["id"], entry["country"],
            product_key=urlparse(u).path.rstrip("/").rsplit("/", 1)[-1],
            name=info["name"], price=info["price"], currency=info.get("currency"), url=u,
            category="/".join(urlparse(u).path.strip("/").split("/")[:-1]) or None,
        ))
    return rows, pages


# --- change detection ---------------------------------------------------------

def diff(prev: dict[str, float], rows: list[dict]) -> list[dict]:
    """Emit a row only where the price is new or has moved.

    Grocery prices barely move day to day, so storing full snapshots would be almost
    entirely duplicate. The interesting data is the change, and this makes it the
    cheap query rather than the expensive one.

    Pure on purpose: the previous prices come from the caller, so this is testable
    without a database and the same logic serves any source of history.
    """
    changes = []
    for r in rows:
        before = prev.get(r["product_key"])
        if before is None:
            changes.append({**r, "change": "new", "previous_price": None})
        elif abs(before - r["price"]) > 1e-9:
            changes.append({**r, "change": "price", "previous_price": before,
                            "delta": round(r["price"] - before, 4)})
    return changes


def diff_against_previous(conn, store_id: str, rows: list[dict]) -> list[dict]:
    """`diff` against the last known price for each product in the store."""
    return diff(store.latest_prices(conn, store_id), rows)


STRATEGIES = {"shopify": pull_shopify, "magento-graphql": pull_magento}


async def pull_store(entry: dict, cand: dict, client, api_key: str | None,
                     transport: str, override_pages: int | None, conn) -> dict | None:
    cfg = entry.get("catalogue") or {}
    method = cfg.get("method", "none")
    if method == "none":
        print(f"  {entry['id']:<24} skipped - {cfg.get('note', 'no catalogue')}", flush=True)
        return None

    max_pages = override_pages if override_pages is not None else cfg.get("max_pages", 0)
    free = Fetcher(client, use_cache=False)
    if cfg.get("needs_unlocker"):
        if not api_key:
            print(f"  {entry['id']:<24} skipped - needs the Unlocker, no API key", flush=True)
            return None
        unlocker = UnlockerFetcher(client, entry["country"], api_key)
        fetch = unlocker.get
    else:
        fetch = free.get

    if method in STRATEGIES:
        rows, pages = await STRATEGIES[method](entry, cfg, fetch, max_pages)
    elif method in ("sitemap", "sitemap-bounded"):
        rows, pages = await pull_sitemap(entry, cfg, fetch, max_pages, cand,
                                         Fetcher(client, use_cache=True))
    else:
        print(f"  {entry['id']:<24} unknown method {method}", flush=True)
        return None

    # de-duplicate on product_key; a paginated API can repeat rows across pages
    seen, deduped = set(), []
    for r in rows:
        if r["product_key"] in seen:
            continue
        seen.add(r["product_key"])
        deduped.append(r)

    changes = diff_against_previous(conn, entry["id"], deduped)
    priced = sum(1 for r in deduped if r.get("unit_price"))
    hit_ceiling = max_pages > 0 and pages >= max_pages
    source = deduped[0].get("source", "puller") if deduped else "puller"

    # A near-total change rate on an established store is far more likely to be a
    # product_key scheme change than a real repricing of every item. Recording the
    # observations anyway would overwrite the price history with noise, so the run is
    # kept as evidence and the history is left alone.
    suspect = (len(deduped) > 100 and len(changes) / len(deduped) > 0.9
               and store.latest_prices(conn, entry["id"]))

    run_id = store.record_run(
        conn, store_id=entry["id"], at=NOW(), method=method, transport=transport,
        source=source, rows=len(deduped), unit_priced=priced, pages=pages,
        ceiling_reached=hit_ceiling, changes=0 if suspect else len(changes),
        coverage=cfg.get("coverage", "full"))

    if suspect:
        store.open_incident(
            conn, store_id=entry["id"], run_id=run_id, kind="mass_change_suppressed",
            opened_at=NOW(),
            evidence={"rows": len(deduped), "changes": len(changes),
                      "reason": "over 90% of an established catalogue changed at once"})
    else:
        store.upsert_products(conn, deduped)
        store.record_observations(conn, run_id, changes, source=source)
    conn.commit()

    doc = {
        "store_id": entry["id"], "name": entry["name"], "country": entry["country"],
        "method": method, "transport": transport, "generated_at": NOW(),
        "coverage": cfg.get("coverage", "full"),
        "coverage_reason": cfg.get("coverage_reason"),
        "pages_fetched": pages, "max_pages": max_pages,
        "ceiling_reached": hit_ceiling,
        "rows": deduped,
    }

    flag = " CEILING" if hit_ceiling else ""
    warn = " MASS-CHANGE SUPPRESSED" if suspect else ""
    print(f"  {entry['id']:<24} {method:<16} rows={len(deduped):<6} priced={priced:<6} "
          f"pages={pages:<4} changed={len(changes):<5} {doc['coverage']}{flag}{warn}",
          flush=True)
    return doc


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--transport", choices=["studio", "http"], default="http",
                    help="studio routes through Scraper Studio; http fetches directly. "
                         "http is for development and cost comparison.")
    ap.add_argument("--max-pages", type=int, default=None, help="override the lock ceiling")
    ap.add_argument("--export-json", action="store_true",
                    help="also write catalogue/<store>.json from the DB after the pull")
    args = ap.parse_args()

    lock = json.loads((HERE / "fleet.lock.json").read_text())
    cands = {c["id"]: c for c in json.loads((HERE / "candidates.json").read_text())["candidates"]}
    fleet = [e for e in lock["fleet"] if not args.ids or e["id"] in args.ids]
    api_key = os.environ.get("BRIGHTDATA_API_KEY")

    conn = store.connect()
    for e in lock["fleet"]:
        store.upsert_store(conn, e)
    conn.commit()

    print(f"catalogue pull: {len(fleet)} stores, transport={args.transport}\n", flush=True)
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, http2=True,
                                 timeout=60) as client:
        docs = []
        for e in fleet:
            try:
                d = await pull_store(e, cands.get(e["id"], {}), client, api_key,
                                     args.transport, args.max_pages, conn)
            except Exception as exc:  # noqa: BLE001 - one bad store must not stop the pull
                print(f"  {e['id']:<24} FAILED {type(exc).__name__}: {exc}"[:140], flush=True)
                d = None
            if d:
                docs.append(d)

    if args.export_json:
        store.export_json(conn, OUT)
    conn.commit()
    conn.close()

    total = sum(len(d["rows"]) for d in docs)
    priced = sum(sum(1 for r in d["rows"] if r.get("unit_price")) for d in docs)
    print(f"\n{total} products across {len(docs)} stores, {priced} with a unit price")
    print(f"wrote {store.DB_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
