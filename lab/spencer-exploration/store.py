# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""SQLite store for the catalogue.

Per-store JSON files were fine while the catalogue was one pull of one store. They stop
being fine the moment you want to ask anything across stores - cheapest rice in PH today,
every price that moved this week, which products a store stopped listing. Those are joins,
and joins want a database.

This is also the handoff artefact. The app that eventually serves this data is not built
yet, so the schema here is the de-facto contract it inherits: one file, openable with any
SQLite client, no server to stand up.

Design notes that are not obvious:

- **History is change-only.** A row lands in price_observations when a price first appears
  or when it moves, never on every run. Grocery prices barely move day to day, so full
  snapshots would be ~99% duplicate. `runs` carries the per-run summary that makes a
  truncated pull distinguishable from a genuine mass price move - without it, a store that
  returns 40 rows instead of 1,600 looks like every product crashed in price.
- **`source` is on the observation, not the run.** When a Studio collector fails and the
  puller covers for it, the data continues but every row it produced says so.
- **Sizes are stored decomposed**, not as JSON, because unit price is the whole point of
  parsing them and you cannot index or compare inside a JSON blob.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent

# Module global rather than a constant so tests can redirect it, matching how catalogue.py
# exposes OUT. Reassign store.DB_PATH, then call connect().
DB_PATH = HERE / "catalogue.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS stores (
    store_id            TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    country             TEXT NOT NULL,
    currency            TEXT,
    method              TEXT,
    endpoint            TEXT,
    max_pages           INTEGER,
    coverage            TEXT,
    coverage_reason     TEXT,
    index_contributor   INTEGER NOT NULL DEFAULT 0,
    studio_collector_id TEXT,
    needs_browser       INTEGER NOT NULL DEFAULT 0,
    needs_unlocker      INTEGER NOT NULL DEFAULT 0
);

-- Identity is (store_id, product_key). The same physical product in two stores is two
-- rows on purpose: matching them across retailers is a modelling decision the app makes,
-- not something the collector should silently assume.
CREATE TABLE IF NOT EXISTS products (
    store_id         TEXT NOT NULL,
    product_key      TEXT NOT NULL,
    name             TEXT NOT NULL,
    url              TEXT,
    category         TEXT,
    unit             TEXT,     -- the size exactly as the store displayed it
    size_value       REAL,     -- 5, 0.25, 24
    size_uom         TEXT,     -- kg, oz, ml, count
    size_quantity    REAL,     -- normalised into the base unit: 5000, 250, 24
    size_base_uom    TEXT,     -- g | ml | count
    size_form        TEXT,     -- plain | multipack | fraction | range | volume | count
    size_approximate INTEGER NOT NULL DEFAULT 0,
    first_seen       TEXT NOT NULL,
    last_seen        TEXT NOT NULL,
    PRIMARY KEY (store_id, product_key)
);

CREATE TABLE IF NOT EXISTS runs (
    run_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id        TEXT NOT NULL,
    at              TEXT NOT NULL,
    method          TEXT,
    transport       TEXT,      -- studio | http
    source          TEXT,      -- studio | puller: what actually produced the rows
    rows            INTEGER NOT NULL DEFAULT 0,
    unit_priced     INTEGER NOT NULL DEFAULT 0,
    pages           INTEGER NOT NULL DEFAULT 0,
    ceiling_reached INTEGER NOT NULL DEFAULT 0,
    changes         INTEGER NOT NULL DEFAULT 0,
    coverage        TEXT,
    credits_usd     REAL
);

CREATE TABLE IF NOT EXISTS price_observations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           INTEGER REFERENCES runs(run_id),
    store_id         TEXT NOT NULL,
    product_key      TEXT NOT NULL,
    observed_at      TEXT NOT NULL,
    price            REAL NOT NULL,
    currency         TEXT NOT NULL,
    unit_price       REAL,     -- per kg / per litre / per item, see unit_price_basis
    unit_price_basis TEXT,
    in_stock         INTEGER,
    source           TEXT NOT NULL DEFAULT 'puller',
    change           TEXT NOT NULL,   -- new | price
    previous_price   REAL,
    delta            REAL
);

-- Reserved for the app. Written today only when a Studio collector fails and the puller
-- covers for it, so a fallback is never silent.
CREATE TABLE IF NOT EXISTS incidents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id    TEXT NOT NULL,
    run_id      INTEGER REFERENCES runs(run_id),
    kind        TEXT NOT NULL,
    opened_at   TEXT NOT NULL,
    resolved_at TEXT,
    evidence    TEXT
);

CREATE INDEX IF NOT EXISTS idx_obs_product ON price_observations(store_id, product_key, id);
CREATE INDEX IF NOT EXISTS idx_obs_at      ON price_observations(observed_at);
CREATE INDEX IF NOT EXISTS idx_runs_store  ON runs(store_id, at);

-- Latest known price per product. Joined on MAX(id) rather than MAX(observed_at) because
-- two observations can share a timestamp (the pull writes to whole seconds) and a tie
-- would return both rows.
CREATE VIEW IF NOT EXISTS latest_price AS
SELECT o.*
FROM price_observations o
JOIN (SELECT store_id, product_key, MAX(id) AS mid
      FROM price_observations GROUP BY store_id, product_key) m
  ON m.mid = o.id;
"""


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Open the store, creating the schema if it is not there yet."""
    conn = sqlite3.connect(str(path or DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


# --- writes -------------------------------------------------------------------

def upsert_store(conn: sqlite3.Connection, entry: dict) -> None:
    """Record a fleet member from its fleet.lock.json entry."""
    cfg = entry.get("catalogue") or {}
    conn.execute(
        """INSERT INTO stores (store_id, name, country, currency, method, endpoint,
                               max_pages, coverage, coverage_reason, index_contributor,
                               studio_collector_id, needs_browser, needs_unlocker)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(store_id) DO UPDATE SET
             name=excluded.name, country=excluded.country, currency=excluded.currency,
             method=excluded.method, endpoint=excluded.endpoint,
             max_pages=excluded.max_pages, coverage=excluded.coverage,
             coverage_reason=excluded.coverage_reason,
             index_contributor=excluded.index_contributor,
             studio_collector_id=excluded.studio_collector_id,
             needs_browser=excluded.needs_browser, needs_unlocker=excluded.needs_unlocker""",
        (entry["id"], entry.get("name") or entry["id"], entry["country"],
         {"PH": "PHP", "US": "USD"}.get(entry["country"]),
         cfg.get("method"), cfg.get("endpoint"), cfg.get("max_pages"),
         cfg.get("coverage", "full"), cfg.get("coverage_reason"),
         int(bool(entry.get("index_contributor"))), entry.get("studio_collector_id"),
         int(bool(cfg.get("needs_browser"))), int(bool(cfg.get("needs_unlocker")))),
    )


def upsert_products(conn: sqlite3.Connection, rows: list[dict]) -> None:
    """Insert or refresh product identity. first_seen is preserved across runs."""
    for r in rows:
        size = r.get("size") or {}
        conn.execute(
            """INSERT INTO products (store_id, product_key, name, url, category, unit,
                                     size_value, size_uom, size_quantity, size_base_uom,
                                     size_form, size_approximate, first_seen, last_seen)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(store_id, product_key) DO UPDATE SET
                 name=excluded.name, url=excluded.url, category=excluded.category,
                 unit=excluded.unit, size_value=excluded.size_value,
                 size_uom=excluded.size_uom, size_quantity=excluded.size_quantity,
                 size_base_uom=excluded.size_base_uom, size_form=excluded.size_form,
                 size_approximate=excluded.size_approximate,
                 last_seen=excluded.last_seen""",
            (r["store_id"], r["product_key"], r["name"], r.get("url"), r.get("category"),
             r.get("unit"), size.get("value"), size.get("uom"), size.get("quantity"),
             size.get("base_uom"), size.get("form"), int(bool(size.get("approximate"))),
             r["observed_at"], r["observed_at"]),
        )


def record_run(conn: sqlite3.Connection, *, store_id, at, method, transport, source,
               rows, unit_priced, pages, ceiling_reached, changes, coverage,
               credits_usd=None) -> int:
    cur = conn.execute(
        """INSERT INTO runs (store_id, at, method, transport, source, rows, unit_priced,
                             pages, ceiling_reached, changes, coverage, credits_usd)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (store_id, at, method, transport, source, rows, unit_priced, pages,
         int(bool(ceiling_reached)), changes, coverage, credits_usd),
    )
    return cur.lastrowid


def record_observations(conn: sqlite3.Connection, run_id: int | None,
                        changes: list[dict], source: str = "puller") -> None:
    """Write the change rows. Only prices that are new or that moved reach this table."""
    for c in changes:
        up = c.get("unit_price") or {}
        conn.execute(
            """INSERT INTO price_observations (run_id, store_id, product_key, observed_at,
                   price, currency, unit_price, unit_price_basis, in_stock, source,
                   change, previous_price, delta)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (run_id, c["store_id"], c["product_key"], c["observed_at"], c["price"],
             c["currency"], up.get("value"), up.get("basis"),
             int(bool(c.get("in_stock"))), c.get("source", source),
             c.get("change", "new"), c.get("previous_price"), c.get("delta")),
        )


def open_incident(conn: sqlite3.Connection, *, store_id, run_id, kind, opened_at,
                  evidence: dict) -> int:
    cur = conn.execute(
        """INSERT INTO incidents (store_id, run_id, kind, opened_at, evidence)
           VALUES (?,?,?,?,?)""",
        (store_id, run_id, kind, opened_at, json.dumps(evidence)),
    )
    return cur.lastrowid


# --- reads --------------------------------------------------------------------

def latest_prices(conn: sqlite3.Connection, store_id: str) -> dict[str, float]:
    """{product_key: last known price} - the input change detection compares against."""
    return {r["product_key"]: r["price"] for r in conn.execute(
        "SELECT product_key, price FROM latest_price WHERE store_id = ?", (store_id,))}


def store_totals(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return list(conn.execute(
        """SELECT p.store_id, s.country, COUNT(*) AS products,
                  SUM(CASE WHEN p.size_quantity IS NOT NULL THEN 1 ELSE 0 END) AS sized
           FROM products p LEFT JOIN stores s ON s.store_id = p.store_id
           GROUP BY p.store_id ORDER BY products DESC"""))


# --- migration ----------------------------------------------------------------

def _closest_run(runs: list[sqlite3.Row], store_id: str, at: str) -> int | None:
    """Attach a legacy change row to a run. The JSONL logs carry no run id, so the
    only link available is the timestamp, and the two are written seconds apart."""
    cands = [r for r in runs if r["store_id"] == store_id]
    if not cands:
        return None
    return min(cands, key=lambda r: abs(_t(r["at"]) - _t(at)))["run_id"]


def _t(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def migrate_from_json(conn: sqlite3.Connection, out_dir: Path, lock: dict | None = None) -> dict:
    """Load the JSON/JSONL era into the database without losing anything.

    Three sources, in dependency order:
      runs.jsonl    -> runs        (needed first; observations reference a run)
      changes.jsonl -> observations (the real price history, with previous_price/delta)
      <store>.json  -> products, plus a baseline observation for anything the change
                       log does not already cover, so latest_price is complete

    The change log alone is not enough: it was reset to a clean baseline after the dev
    logs were found polluted, so it holds 59 rows against 17,792 products. The snapshots
    alone are not enough either - they carry no previous price. Both are needed.
    """
    stats = {"runs": 0, "products": 0, "observations": 0, "baseline": 0, "stores": 0}

    for entry in (lock or {}).get("fleet", []):
        upsert_store(conn, entry)
        stats["stores"] += 1

    runs_path = out_dir / "runs.jsonl"
    if runs_path.exists():
        for line in runs_path.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            record_run(conn, store_id=r["store_id"], at=r["at"], method=r.get("method"),
                       transport=r.get("transport"), source="puller",
                       rows=r.get("rows", 0), unit_priced=r.get("unit_priced", 0),
                       pages=r.get("pages", 0),
                       ceiling_reached=r.get("ceiling_reached", False),
                       changes=r.get("changes", 0), coverage=r.get("coverage"))
            stats["runs"] += 1
    runs = list(conn.execute("SELECT run_id, store_id, at FROM runs"))

    changes_path = out_dir / "changes.jsonl"
    if changes_path.exists():
        for line in changes_path.read_text().splitlines():
            if not line.strip():
                continue
            c = json.loads(line)
            record_observations(conn, _closest_run(runs, c["store_id"], c["observed_at"]),
                                [c], source="puller")
            stats["observations"] += 1

    for path in sorted(out_dir.glob("*.json")):
        doc = json.loads(path.read_text())
        rows = doc.get("rows") or []
        if not rows:
            continue
        upsert_products(conn, rows)
        stats["products"] += len(rows)
        run_id = _closest_run(runs, doc["store_id"], doc.get("generated_at") or rows[0]["observed_at"])
        known = latest_prices(conn, doc["store_id"])
        baseline = [{**r, "change": "new", "previous_price": None}
                    for r in rows
                    if known.get(r["product_key"]) is None
                    or abs(known[r["product_key"]] - r["price"]) > 1e-9]
        for b in baseline:
            if known.get(b["product_key"]) is not None:
                b["change"] = "price"
                b["previous_price"] = known[b["product_key"]]
                b["delta"] = round(b["price"] - b["previous_price"], 4)
        record_observations(conn, run_id, baseline, source="puller")
        stats["baseline"] += len(baseline)

    conn.commit()
    return stats


# --- export -------------------------------------------------------------------

def _size_from_row(r: sqlite3.Row) -> dict | None:
    if r["size_quantity"] is None:
        return None
    return {"raw": r["unit"], "value": r["size_value"], "uom": r["size_uom"],
            "approximate": bool(r["size_approximate"]), "form": r["size_form"],
            "quantity": r["size_quantity"], "base_uom": r["size_base_uom"]}


def export_json(conn: sqlite3.Connection, out_dir: Path) -> list[str]:
    """Regenerate the per-store JSON from the database.

    The files are a view now, not the store - useful for eyeballing and diffing, and
    regenerable, which is why they stay gitignored.
    """
    out_dir.mkdir(exist_ok=True)
    written = []
    for s in conn.execute("SELECT * FROM stores"):
        prods = list(conn.execute(
            "SELECT * FROM products WHERE store_id = ? ORDER BY product_key", (s["store_id"],)))
        if not prods:
            continue
        latest = {r["product_key"]: r for r in conn.execute(
            "SELECT * FROM latest_price WHERE store_id = ?", (s["store_id"],))}
        run = conn.execute(
            "SELECT * FROM runs WHERE store_id = ? ORDER BY run_id DESC LIMIT 1",
            (s["store_id"],)).fetchone()
        rows = []
        for p in prods:
            o = latest.get(p["product_key"])
            if o is None:
                continue
            size = _size_from_row(p)
            rows.append({
                "store_id": p["store_id"], "country": s["country"],
                "product_key": p["product_key"], "name": p["name"], "price": o["price"],
                "currency": o["currency"], "unit": p["unit"],
                "in_stock": bool(o["in_stock"]), "url": p["url"],
                "observed_at": o["observed_at"], "category": p["category"],
                "size": size,
                "unit_price": ({"basis": o["unit_price_basis"], "value": o["unit_price"]}
                               if o["unit_price"] is not None else None),
                "source": o["source"],
            })
        doc = {"store_id": s["store_id"], "name": s["name"], "country": s["country"],
               "method": s["method"], "transport": run["transport"] if run else None,
               "generated_at": run["at"] if run else None,
               "coverage": s["coverage"], "coverage_reason": s["coverage_reason"],
               "pages_fetched": run["pages"] if run else 0, "max_pages": s["max_pages"],
               "ceiling_reached": bool(run["ceiling_reached"]) if run else False,
               "rows": rows}
        (out_dir / f"{s['store_id']}.json").write_text(json.dumps(doc, indent=2))
        written.append(s["store_id"])
    return written


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="catalogue.db maintenance")
    ap.add_argument("--migrate", action="store_true",
                    help="load catalogue/*.json + runs.jsonl + changes.jsonl into the DB")
    ap.add_argument("--export-json", action="store_true",
                    help="regenerate catalogue/<store>.json from the DB")
    ap.add_argument("--summary", action="store_true", help="per-store totals")
    ap.add_argument("--dir", default=str(HERE / "catalogue"))
    args = ap.parse_args()

    out_dir = Path(args.dir)
    conn = connect()
    if args.migrate:
        lock = json.loads((HERE / "fleet.lock.json").read_text())
        stats = migrate_from_json(conn, out_dir, lock)
        print(f"migrated: {stats}")
    if args.export_json:
        written = export_json(conn, out_dir)
        print(f"exported {len(written)} stores to {out_dir}/")
    if args.summary or not (args.migrate or args.export_json):
        total = sized = 0
        print(f"{'store':<26}{'country':<9}{'products':>9}{'sized':>8}")
        for r in store_totals(conn):
            print(f"{r['store_id']:<26}{str(r['country']):<9}{r['products']:>9}{r['sized'] or 0:>8}")
            total += r["products"]
            sized += r["sized"] or 0
        obs = conn.execute("SELECT COUNT(*) c FROM price_observations").fetchone()["c"]
        moves = conn.execute(
            "SELECT COUNT(*) c FROM price_observations WHERE change='price'").fetchone()["c"]
        runs = conn.execute("SELECT COUNT(*) c FROM runs").fetchone()["c"]
        print(f"\n{total} products, {sized} sized, {obs} observations "
              f"({moves} real price moves), {runs} runs")
    conn.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
