# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest", "httpx[http2]"]
# ///
"""Tests for the bulk catalogue puller.

The two things that must not break: the page ceiling (a runaway crawl once produced
4,470 unintended rows) and change detection (a truncated pull must never read as a
mass price change).

    uv run --with pytest --with 'httpx[http2]' pytest spencer-exploration/test_catalogue.py -q
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import catalogue as cat  # noqa: E402
import store  # noqa: E402


# --- row shape ---------------------------------------------------------------

def test_row_carries_contract_fields_and_tracker_fields():
    r = cat.row("ph-ever", "PH", product_key=1, name="Farmboy Pandan Rice 5kg",
                price=389.5, currency="PHP", url="https://ever.ph/products/rice")
    for field in ("store_id", "product_key", "name", "price", "currency",
                  "unit", "in_stock", "url", "observed_at"):
        assert field in r, field
    assert r["size"]["quantity"] == pytest.approx(5000.0)
    assert r["unit_price"]["basis"] == "per_kg"
    assert r["unit_price"]["value"] == pytest.approx(77.9)


def test_row_without_a_parseable_size_has_no_unit_price():
    r = cat.row("x", "PH", product_key=2, name="Mystery Item", price=10.0,
                currency="PHP", url="https://x.test/p")
    assert r["size"] is None and r["unit_price"] is None


# --- page ceiling ------------------------------------------------------------

def _fake_shopify(pages: int, per_page: int = 250):
    """A store that would happily serve forever."""
    async def fetch(url, tag, **kw):
        products = [{"id": f"{url}-{i}", "title": f"Item {i} 1kg",
                     "handle": f"item-{i}", "tags": [],
                     "variants": [{"price": "10.00", "available": True}]}
                    for i in range(per_page)]
        return {"status": 200, "body": json.dumps({"products": products})}
    return fetch


def test_ceiling_stops_the_pull_regardless_of_catalogue_size():
    store = {"id": "s", "country": "PH"}
    cfg = {"endpoint": "https://x.test/products.json"}
    rows, pages = asyncio.run(cat.pull_shopify(store, cfg, _fake_shopify(999), max_pages=2))
    assert pages == 2 and len(rows) == 500


def test_short_page_ends_the_pull_before_the_ceiling():
    store = {"id": "s", "country": "PH"}
    cfg = {"endpoint": "https://x.test/products.json"}
    rows, pages = asyncio.run(cat.pull_shopify(store, cfg, _fake_shopify(1, per_page=10),
                                               max_pages=20))
    assert pages == 1 and len(rows) == 10


def test_zero_ceiling_fetches_nothing():
    rows, pages = asyncio.run(cat.pull_shopify({"id": "s", "country": "PH"},
                                               {"endpoint": "https://x.test/products.json"},
                                               _fake_shopify(9), max_pages=0))
    assert pages == 0 and rows == []


def test_products_without_a_usable_price_are_dropped():
    async def fetch(url, tag, **kw):
        return {"status": 200, "body": json.dumps({"products": [
            {"id": 1, "title": "Free Sample", "handle": "a", "tags": [],
             "variants": [{"price": "0.00", "available": True}]},
            {"id": 2, "title": "Rice 1kg", "handle": "b", "tags": [],
             "variants": [{"price": "50.00", "available": True}]},
        ]})}
    rows, _ = asyncio.run(cat.pull_shopify({"id": "s", "country": "PH"},
                                           {"endpoint": "https://x.test/products.json"},
                                           fetch, max_pages=1))
    assert [r["product_key"] for r in rows] == ["2"]


# --- change detection --------------------------------------------------------

@pytest.fixture
def db(monkeypatch):
    """History lives in SQLite now. An in-memory DB keeps these tests as fast and as
    isolated as the tmp_path directory they used to redirect."""
    conn = store.connect(":memory:")
    return conn


def _seed_previous(conn, store_id: str, rows: list[dict]):
    run_id = store.record_run(conn, store_id=store_id, at=cat.NOW(), method="shopify",
                              transport="http", source="puller", rows=len(rows),
                              unit_priced=0, pages=1, ceiling_reached=False,
                              changes=len(rows), coverage="full")
    store.upsert_products(conn, rows)
    store.record_observations(conn, run_id,
                              [{**r, "change": "new", "previous_price": None} for r in rows])


def test_first_ever_pull_marks_everything_new(db):
    rows = [cat.row("s", "PH", product_key="a", name="Rice 1kg", price=50.0,
                    currency="PHP", url="u")]
    changes = cat.diff_against_previous(db, "s", rows)
    assert len(changes) == 1 and changes[0]["change"] == "new"


def test_unchanged_prices_produce_no_rows(db):
    rows = [cat.row("s", "PH", product_key="a", name="Rice 1kg", price=50.0,
                    currency="PHP", url="u")]
    _seed_previous(db, "s", rows)
    assert cat.diff_against_previous(db, "s", rows) == []


def test_a_moved_price_produces_exactly_one_row_with_its_delta(db):
    before = [cat.row("s", "PH", product_key="a", name="Rice 1kg", price=50.0,
                      currency="PHP", url="u")]
    _seed_previous(db, "s", before)
    after = [cat.row("s", "PH", product_key="a", name="Rice 1kg", price=55.0,
                     currency="PHP", url="u")]
    changes = cat.diff_against_previous(db, "s", after)
    assert len(changes) == 1
    assert changes[0]["change"] == "price"
    assert changes[0]["previous_price"] == 50.0
    assert changes[0]["delta"] == pytest.approx(5.0)


def test_a_shrunken_pull_does_not_look_like_price_changes(db):
    """The failure this guards: a truncated catalogue must not read as mass change.

    Products missing from a short pull produce no change rows at all. The run summary
    is what reveals the truncation, which is why it is written every run.
    """
    before = [cat.row("s", "PH", product_key=str(i), name=f"Item {i} 1kg", price=10.0,
                      currency="PHP", url="u") for i in range(100)]
    _seed_previous(db, "s", before)
    truncated = before[:5]
    assert cat.diff_against_previous(db, "s", truncated) == []


def test_a_store_with_no_history_marks_everything_new(db):
    """Replaces the corrupt-previous-file case. The file that could be corrupt is gone;
    the guarantee it protected - no history means everything is new - is not."""
    rows = [cat.row("s", "PH", product_key="a", name="Rice 1kg", price=50.0,
                    currency="PHP", url="u")]
    assert len(cat.diff_against_previous(db, "s", rows)) == 1


def test_a_product_key_seen_at_another_store_is_still_new_here(db):
    """Identity is (store_id, product_key). Shopify numeric ids collide across stores,
    so a shared key must not make one store's history answer for another's."""
    rows_a = [cat.row("store-a", "PH", product_key="8161837154436", name="Rice 1kg",
                      price=50.0, currency="PHP", url="u")]
    _seed_previous(db, "store-a", rows_a)
    rows_b = [cat.row("store-b", "PH", product_key="8161837154436", name="Rice 1kg",
                      price=99.0, currency="PHP", url="u")]
    changes = cat.diff_against_previous(db, "store-b", rows_b)
    assert len(changes) == 1 and changes[0]["change"] == "new"


def test_diff_is_pure_and_needs_no_database():
    """diff() takes its history as an argument, so the comparison logic is testable
    without any storage at all."""
    rows = [cat.row("s", "PH", product_key="a", name="Rice 1kg", price=55.0,
                    currency="PHP", url="u")]
    assert cat.diff({}, rows)[0]["change"] == "new"
    assert cat.diff({"a": 55.0}, rows) == []
    assert cat.diff({"a": 50.0}, rows)[0]["delta"] == pytest.approx(5.0)


# --- bounded pulls -----------------------------------------------------------

def test_category_priority_orders_the_url_budget():
    urls = [
        "https://x.test/toys/robot",
        "https://x.test/food-cupboard/rice-5kg",
        "https://x.test/dairy-chilled/milk-1l",
    ]
    ranked = cat.rank_by_category(urls, ["food-cupboard", "dairy-chilled"])
    assert ranked[0].endswith("rice-5kg")
    assert ranked[1].endswith("milk-1l")
    assert ranked[-1].endswith("robot")


def test_urls_outside_the_priority_list_still_run_last_not_dropped():
    urls = ["https://x.test/misc/thing", "https://x.test/bakery/bread"]
    assert len(cat.rank_by_category(urls, ["bakery"])) == 2
