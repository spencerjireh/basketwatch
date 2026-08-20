# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest", "httpx[http2]"]
# ///
"""Tests for the SQLite catalogue store.

The invariant that matters most: a run summary lands every time, even when nothing
changed. Without it a truncated pull and a quiet day are indistinguishable, which is
the exact failure the change-only history model would otherwise introduce.

    uv run --with pytest --with 'httpx[http2]' pytest lab/spencer-exploration/test_store.py -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import catalogue as cat  # noqa: E402
import store  # noqa: E402


@pytest.fixture
def db():
    return store.connect(":memory:")


def _row(key="a", price=50.0, name="Rice 1kg", store_id="s"):
    return cat.row(store_id, "PH", product_key=key, name=name, price=price,
                   currency="PHP", url=f"https://x.test/products/{key}")


def _run(conn, store_id="s", **kw):
    args = dict(store_id=store_id, at=cat.NOW(), method="shopify", transport="http",
                source="puller", rows=0, unit_priced=0, pages=1, ceiling_reached=False,
                changes=0, coverage="full")
    args.update(kw)
    return store.record_run(conn, **args)


# --- schema -------------------------------------------------------------------

def test_connecting_twice_does_not_rebuild_or_lose_data(tmp_path):
    """connect() runs the schema every open, so it has to be idempotent."""
    path = tmp_path / "c.db"
    conn = store.connect(path)
    _run(conn, rows=3)
    conn.commit()
    conn.close()

    again = store.connect(path)
    assert again.execute("SELECT COUNT(*) c FROM runs").fetchone()["c"] == 1


# --- the run summary invariant ------------------------------------------------

def test_a_run_with_zero_changes_still_writes_a_run_row(db):
    """The whole point of the summary. 'Nothing changed' and 'the pull was truncated'
    are only distinguishable because the run row lands either way."""
    _run(db, rows=1600, changes=0)
    assert db.execute("SELECT COUNT(*) c FROM runs").fetchone()["c"] == 1
    assert db.execute("SELECT COUNT(*) c FROM price_observations").fetchone()["c"] == 0


def test_a_truncated_pull_is_visible_in_the_run_row(db):
    _run(db, rows=1600, changes=0)
    _run(db, rows=40, changes=0)
    counts = [r["rows"] for r in db.execute("SELECT rows FROM runs ORDER BY run_id")]
    assert counts == [1600, 40]


# --- products -----------------------------------------------------------------

def test_upsert_preserves_first_seen_and_advances_last_seen(db):
    first = _row()
    store.upsert_products(db, [first])
    later = {**first, "observed_at": "2030-01-01T00:00:00Z", "name": "Rice 1kg (new pack)"}
    store.upsert_products(db, [later])

    p = db.execute("SELECT * FROM products").fetchone()
    assert p["first_seen"] == first["observed_at"]
    assert p["last_seen"] == "2030-01-01T00:00:00Z"
    assert p["name"] == "Rice 1kg (new pack)"
    assert db.execute("SELECT COUNT(*) c FROM products").fetchone()["c"] == 1


def test_size_is_stored_decomposed_not_as_a_blob(db):
    """Unit price is the comparison primitive, so the size has to be queryable."""
    store.upsert_products(db, [_row(name="Cooking Oil 1.5L")])
    p = db.execute("SELECT * FROM products").fetchone()
    assert p["size_quantity"] == pytest.approx(1500.0)
    assert p["size_base_uom"] == "ml"
    assert p["unit"] == "1.5L"


def test_a_product_with_no_parseable_size_stores_nulls_not_guesses(db):
    store.upsert_products(db, [_row(name="Assorted Party Tray")])
    p = db.execute("SELECT * FROM products").fetchone()
    assert p["size_quantity"] is None and p["size_base_uom"] is None


# --- observations and latest_price --------------------------------------------

def test_latest_price_returns_the_most_recent_observation(db):
    run1 = _run(db)
    store.record_observations(db, run1, [{**_row(price=50.0), "change": "new",
                                          "previous_price": None}])
    run2 = _run(db)
    store.record_observations(db, run2, [{**_row(price=55.0), "change": "price",
                                          "previous_price": 50.0, "delta": 5.0}])

    assert store.latest_prices(db, "s") == {"a": 55.0}
    assert db.execute("SELECT COUNT(*) c FROM price_observations").fetchone()["c"] == 2


def test_latest_price_is_per_store_not_per_product_key(db):
    run = _run(db)
    store.record_observations(db, run, [
        {**_row(store_id="store-a", price=50.0), "change": "new", "previous_price": None},
        {**_row(store_id="store-b", price=99.0), "change": "new", "previous_price": None},
    ])
    assert store.latest_prices(db, "store-a") == {"a": 50.0}
    assert store.latest_prices(db, "store-b") == {"a": 99.0}


def test_the_source_of_every_observation_is_recorded(db):
    """A fallback must never be invisible: the row itself says which transport made it."""
    run = _run(db, source="puller")
    store.record_observations(db, run, [{**_row(), "change": "new",
                                         "previous_price": None}], source="puller")
    assert db.execute("SELECT source FROM price_observations").fetchone()["source"] == "puller"


# --- incidents ----------------------------------------------------------------

def test_an_incident_can_exist_without_a_product_or_a_run(db):
    """A tripped budget belongs to no product and possibly to no run."""
    store.open_incident(db, store_id="s", run_id=None, kind="budget_tripped",
                        opened_at=cat.NOW(), evidence={"cap": 5.0})
    inc = db.execute("SELECT * FROM incidents").fetchone()
    assert inc["run_id"] is None
    assert json.loads(inc["evidence"])["cap"] == 5.0


# --- export -------------------------------------------------------------------

def test_export_emits_the_same_keys_the_puller_used_to_write(db, tmp_path):
    """The JSON files are a view now. Anything reading them must not notice."""
    store.upsert_store(db, {"id": "s", "name": "Store", "country": "PH",
                            "catalogue": {"method": "shopify", "max_pages": 20}})
    run = _run(db, rows=1)
    store.upsert_products(db, [_row()])
    store.record_observations(db, run, [{**_row(), "change": "new", "previous_price": None}])
    db.commit()

    store.export_json(db, tmp_path)
    doc = json.loads((tmp_path / "s.json").read_text())
    assert set(doc) >= {"store_id", "name", "country", "method", "transport",
                        "generated_at", "coverage", "coverage_reason", "pages_fetched",
                        "max_pages", "ceiling_reached", "rows"}
    assert doc["rows"][0]["product_key"] == "a"
    assert doc["rows"][0]["price"] == 50.0
