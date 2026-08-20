# /// script
# requires-python = ">=3.11"
# dependencies = ["psycopg[binary]"]
# ///
"""One-time load of catalogue.db into the deployed Postgres.

The SQLite store was the handoff artefact while the app was being built. This
moves it into the database the app actually reads, once, keeping the shape that
was proven against 163 vetted sites: identity is (store_id, product_key), sizes
stay decomposed, history stays change-only.

Three JSON files come along, because the database is the source of truth from
here and they hold things catalogue.db never modelled:

  studio-collectors.json -> scrapers   (16 collectors; the DB's four
                                        studio_collector_id values are stale)
  items.json             -> items      (the canonical item registry)
  basket-map.json        -> basket_map (which product stands in for an item)

Usage:
    uv run spencer-exploration/to_postgres.py --dry-run
    uv run spencer-exploration/to_postgres.py --url postgres://...
    uv run spencer-exploration/to_postgres.py --verify --url postgres://...

With no --url the connection string comes from DATABASE_URL, or from the
repo-root .env if that is unset.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg

HERE = Path(__file__).parent
ROOT = HERE.parent
DB_PATH = HERE / "catalogue.db"

# The tables this script owns. Any of them holding rows means someone has
# already loaded data; a first load must not turn into a half-merge.
TARGETS = ["scrapers", "stores", "runs", "products", "price_observations",
           "incidents", "items", "basket_map"]

# Bright Data collector lifecycle -> the ScraperState vocabulary the dashboard
# speaks (packages/shared/src/index.ts).
COLLECTOR_STATUS = {"ready": "healthy", "partial": "suspect",
                    "abandoned": "manual_attention"}


def db_url(explicit: str | None) -> str:
    import os
    if explicit:
        return explicit
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("no database url: pass --url, set DATABASE_URL, or put it in the root .env")


def ts(value: str | None) -> datetime | None:
    """catalogue.db writes ISO 8601 with a literal Z; Postgres wants an offset."""
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def money(value: float | None) -> Decimal | None:
    """REAL -> numeric. Round-trips through str so the float's binary noise is
    not carried into an exact type."""
    return None if value is None else Decimal(str(value))


def slug(url: str) -> str:
    """product_key for a hand-curated pick. ph-landers keys its catalogue by URL
    slug, so a curated row keyed the same way is indistinguishable from a
    pulled one."""
    return url.rstrip("/").rsplit("/", 1)[-1]


# --- sources ------------------------------------------------------------------

def load_sources() -> dict:
    sqlite = sqlite3.connect(DB_PATH)
    sqlite.row_factory = sqlite3.Row

    collectors = json.loads((HERE / "studio-collectors.json").read_text())["collectors"]
    items_doc = json.loads((HERE / "items.json").read_text())
    basket = json.loads((HERE / "basket-map.json").read_text())

    stores = [dict(r) for r in sqlite.execute("SELECT * FROM stores")]
    products = [dict(r) for r in sqlite.execute("SELECT * FROM products")]
    runs = [dict(r) for r in sqlite.execute("SELECT * FROM runs")]
    obs = [dict(r) for r in sqlite.execute("SELECT * FROM price_observations ORDER BY id")]
    incidents = [dict(r) for r in sqlite.execute("SELECT * FROM incidents")]

    # basket-map.json pins a URL, not a product_key. Resolve it inside the store.
    by_url = {(p["store_id"], p["url"]): p["product_key"] for p in products if p["url"]}
    picked_at = ts(basket["generated_at"])

    basket_rows, curated_products, unresolved = [], [], []
    for store_id, s in basket["stores"].items():
        for item_key, e in s["items"].items():
            url = e.get("url")
            key = by_url.get((store_id, url)) if url else None
            if url and key is None:
                # Curated by hand from a page that is not in the store's
                # catalogue. Keep the curation as a product with no price -
                # these two were never priced (price is null in the map).
                key = slug(url)
                size = e.get("size") or {}
                curated_products.append({
                    "store_id": store_id, "product_key": key, "name": e.get("name") or key,
                    "url": url, "category": e.get("category"),
                    "unit": size.get("raw"), "size_value": size.get("value"),
                    "size_uom": size.get("uom"), "size_quantity": size.get("quantity"),
                    "size_base_uom": size.get("base_uom"), "size_form": size.get("form"),
                    "size_approximate": int(bool(size.get("approximate"))),
                    "first_seen": basket["generated_at"], "last_seen": basket["generated_at"],
                })
                unresolved.append((store_id, item_key, e.get("status")))
            basket_rows.append({
                "item_key": item_key, "store_id": store_id, "product_key": key,
                "url": url, "status": e["status"], "via": e.get("via"),
                "note": e.get("note"), "why": e.get("why"),
                "pricing_note": e.get("pricing_note"), "category": e.get("category"),
                "category_tier": e.get("category_tier"), "candidates": e.get("candidates"),
                "target_size": e.get("target_size"), "picked_at": picked_at,
            })

    sqlite.close()
    return {
        "collectors": collectors, "items_doc": items_doc, "stores": stores,
        "products": products, "curated_products": curated_products, "runs": runs,
        "obs": obs, "incidents": incidents, "basket_rows": basket_rows,
        "unresolved": unresolved,
        # The registry file is written after every create, so it wins over the
        # four studio_collector_id values in the DB, three of which are stale.
        "collector_by_store": {sid: c["collector_id"] for sid, c in collectors.items()},
    }


# --- load ---------------------------------------------------------------------

def assert_empty(cur) -> None:
    for table in TARGETS:
        cur.execute(f'SELECT count(*) FROM "{table}"')
        n = cur.fetchone()[0]
        if n:
            sys.exit(f"refusing to load: {table} already holds {n} rows. "
                     "This is a first load, not a merge.")


def load(conn, src: dict) -> None:
    cur = conn.cursor()
    assert_empty(cur)

    cur.executemany(
        'INSERT INTO "scrapers" (id, name, target_site, output_schema, status) '
        "VALUES (%s,%s,%s,%s,%s)",
        [(c["collector_id"], c["name"], c["seed_url"],
          json.dumps({"template": c.get("template"),
                      "description_sha": c.get("description_sha"),
                      "description": c.get("description")}),
          COLLECTOR_STATUS.get(c.get("status"), "manual_attention"))
         for c in src["collectors"].values()])

    cur.executemany(
        'INSERT INTO "stores" (store_id, name, country, currency, method, endpoint, '
        "max_pages, coverage, coverage_reason, index_contributor, studio_collector_id, "
        "needs_browser, needs_unlocker) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [(s["store_id"], s["name"], s["country"], s["currency"], s["method"],
          s["endpoint"], s["max_pages"], s["coverage"], s["coverage_reason"],
          bool(s["index_contributor"]),
          src["collector_by_store"].get(s["store_id"]),
          bool(s["needs_browser"]), bool(s["needs_unlocker"]))
         for s in src["stores"]])

    # Explicit run ids: price_observations.run_id points at them.
    cur.executemany(
        'INSERT INTO "runs" (id, store_id, at, method, transport, source, "rows", '
        'unit_priced, pages, ceiling_reached, changes, coverage, credits_usd) '
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [(r["run_id"], r["store_id"], ts(r["at"]), r["method"], r["transport"],
          r["source"], r["rows"], r["unit_priced"], r["pages"],
          bool(r["ceiling_reached"]), r["changes"], r["coverage"],
          money(r["credits_usd"]))
         for r in src["runs"]])

    with cur.copy(
        'COPY "products" (store_id, product_key, name, url, category, unit, size_value, '
        "size_uom, size_quantity, size_base_uom, size_form, size_approximate, "
        "first_seen, last_seen) FROM STDIN"
    ) as cp:
        for p in src["products"] + src["curated_products"]:
            cp.write_row((p["store_id"], p["product_key"], p["name"], p["url"],
                          p["category"], p["unit"], p["size_value"], p["size_uom"],
                          p["size_quantity"], p["size_base_uom"], p["size_form"],
                          bool(p["size_approximate"]), ts(p["first_seen"]),
                          ts(p["last_seen"])))

    with cur.copy(
        'COPY "price_observations" (id, run_id, store_id, product_key, observed_at, '
        'price, currency, unit_price, unit_price_basis, in_stock, source, "change", '
        "previous_price, delta) FROM STDIN"
    ) as cp:
        for o in src["obs"]:
            cp.write_row((o["id"], o["run_id"], o["store_id"], o["product_key"],
                          ts(o["observed_at"]), money(o["price"]), o["currency"],
                          money(o["unit_price"]), o["unit_price_basis"],
                          None if o["in_stock"] is None else bool(o["in_stock"]),
                          o["source"], o["change"], money(o["previous_price"]),
                          money(o["delta"])))

    cur.executemany(
        'INSERT INTO "incidents" (store_id, run_id, kind, evidence, state, opened_at, '
        "resolved_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        [(i["store_id"], i["run_id"], i["kind"], i["evidence"] or "{}",
          "resolved" if i["resolved_at"] else "open", ts(i["opened_at"]),
          ts(i["resolved_at"]))
         for i in src["incidents"]])

    doc = src["items_doc"]
    cur.executemany(
        'INSERT INTO "items" (key, label, tier, "group", group_weight_note, '
        "numbeo_equivalent, normal_unit, target_size, match, categories, "
        "min_base_quantity, min_base_quantity_note, spec_version) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [(i["key"], i["label"], i["tier"], i["group"], i.get("group_weight_note"),
          i.get("numbeo_equivalent"), i["normal_unit"],
          json.dumps(i.get("target_size") or {}), json.dumps(i.get("match") or {}),
          json.dumps(i.get("categories") or []), i.get("min_base_quantity"),
          i.get("min_base_quantity_note"), doc.get("spec_version", 1))
         for i in doc["items"]])

    cur.executemany(
        'INSERT INTO "basket_map" (item_key, store_id, product_key, url, status, via, '
        "note, why, pricing_note, category, category_tier, candidates, target_size, "
        "picked_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [(b["item_key"], b["store_id"], b["product_key"], b["url"], b["status"],
          b["via"], b["note"], b["why"], b["pricing_note"], b["category"],
          b["category_tier"], b["candidates"], b["target_size"], b["picked_at"])
         for b in src["basket_rows"]])

    # The explicit ids above left both sequences at 1.
    cur.execute("SELECT setval('runs_id_seq', (SELECT max(id) FROM runs))")
    cur.execute("SELECT setval('price_observations_id_seq', "
                "(SELECT max(id) FROM price_observations))")


# --- verify -------------------------------------------------------------------

def verify(conn, src: dict) -> int:
    cur = conn.cursor()
    expected = {
        "scrapers": len(src["collectors"]),
        "stores": len(src["stores"]),
        "runs": len(src["runs"]),
        "products": len(src["products"]) + len(src["curated_products"]),
        "price_observations": len(src["obs"]),
        "incidents": len(src["incidents"]),
        "items": len(src["items_doc"]["items"]),
        "basket_map": len(src["basket_rows"]),
    }
    failures = 0
    for table, want in expected.items():
        cur.execute(f'SELECT count(*) FROM "{table}"')
        got = cur.fetchone()[0]
        ok = got == want
        failures += not ok
        print(f"  {'ok ' if ok else 'BAD'} {table:<20} {got} (expected {want})")

    sqlite_sum = sum(Decimal(str(o["price"])) for o in src["obs"])
    cur.execute("SELECT sum(price) FROM price_observations")
    pg_sum = cur.fetchone()[0]
    ok = pg_sum == sqlite_sum
    failures += not ok
    print(f"  {'ok ' if ok else 'BAD'} {'sum(price)':<20} {pg_sum} (expected {sqlite_sum})")

    checks = [
        ("latest_price rows", "SELECT count(*) FROM latest_price", len(src["obs"])),
        ("orphan observations",
         "SELECT count(*) FROM price_observations o LEFT JOIN products p "
         "ON (p.store_id, p.product_key) = (o.store_id, o.product_key) "
         "WHERE p.product_key IS NULL", 0),
        ("orphan runs",
         "SELECT count(*) FROM price_observations o LEFT JOIN runs r ON r.id = o.run_id "
         "WHERE o.run_id IS NOT NULL AND r.id IS NULL", 0),
        ("verified pins unresolved",
         "SELECT count(*) FROM basket_map WHERE status = 'verified' "
         "AND product_key IS NULL", 0),
        ("stores pointing at no scraper",
         "SELECT count(*) FROM stores s LEFT JOIN scrapers c "
         "ON c.id = s.studio_collector_id "
         "WHERE s.studio_collector_id IS NOT NULL AND c.id IS NULL", 0),
        ("basket pins with a missing product",
         "SELECT count(*) FROM basket_map b LEFT JOIN products p "
         "ON (p.store_id, p.product_key) = (b.store_id, b.product_key) "
         "WHERE b.product_key IS NOT NULL AND p.product_key IS NULL", 0),
    ]
    for label, query, want in checks:
        cur.execute(query)
        got = cur.fetchone()[0]
        ok = got == want
        failures += not ok
        print(f"  {'ok ' if ok else 'BAD'} {label:<20} {got} (expected {want})")

    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description="load catalogue.db into Postgres")
    ap.add_argument("--url", help="postgres url; defaults to DATABASE_URL or the root .env")
    ap.add_argument("--dry-run", action="store_true", help="report what would be written")
    ap.add_argument("--verify", action="store_true", help="check an existing load")
    args = ap.parse_args()

    src = load_sources()
    counts = {
        "scrapers": len(src["collectors"]), "stores": len(src["stores"]),
        "runs": len(src["runs"]),
        "products": f'{len(src["products"])} + {len(src["curated_products"])} curated',
        "price_observations": len(src["obs"]), "incidents": len(src["incidents"]),
        "items": len(src["items_doc"]["items"]), "basket_map": len(src["basket_rows"]),
    }
    resolved = sum(1 for b in src["basket_rows"] if b["product_key"])
    print("catalogue.db + json ->")
    for k, v in counts.items():
        print(f"  {k:<20} {v}")
    print(f"  {'basket pins':<20} {resolved} resolved to a product")
    for store_id, item_key, status in src["unresolved"]:
        print(f"    curated, not in catalogue: {store_id} {item_key} ({status})")

    if args.dry_run:
        return 0

    url = db_url(args.url)
    host = url.split("@")[-1]
    with psycopg.connect(url, connect_timeout=30) as conn:
        if args.verify:
            print(f"\nverifying {host}")
            failures = verify(conn, src)
            print("\nall checks passed" if not failures else f"\n{failures} CHECK(S) FAILED")
            return 1 if failures else 0

        print(f"\nloading into {host}")
        load(conn, src)          # one transaction; psycopg commits on clean exit
        conn.commit()
        print("committed\n")
        failures = verify(conn, src)
        print("\nall checks passed" if not failures else f"\n{failures} CHECK(S) FAILED")
        return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
