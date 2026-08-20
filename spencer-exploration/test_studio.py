# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest", "httpx[http2]"]
# ///
"""Tests for the Scraper Studio transport.

Two of these guard failures that would be expensive rather than merely wrong:
product_key drift would overwrite price history that cannot be re-collected, and an
over-long description is only rejected after the create call has been made.

    uv run --with pytest --with 'httpx[http2]' pytest spencer-exploration/test_studio.py -q
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import catalogue as cat  # noqa: E402
import studio  # noqa: E402


# --- descriptions -------------------------------------------------------------

def test_every_fleet_description_fits_the_cli_limit():
    """The CLI rejects over 500 chars, and it rejects it after the call is made."""
    lock = json.loads((HERE / "fleet.lock.json").read_text())
    for entry in lock["fleet"]:
        cfg = entry.get("catalogue") or {}
        if cfg.get("method", "none") == "none":
            continue
        desc = studio.build_description(entry, cfg)
        assert len(desc) <= studio.MAX_DESCRIPTION, entry["id"]


def test_every_description_bounds_the_crawl_and_asks_for_size():
    """Testing a prompt is unusual. The 4,470-row incident is the reason: an unbounded
    description crawled ~150 pages because it never said stop. And without an explicit
    size request the field arrives empty, which silently kills every unit price."""
    for desc in studio.TEMPLATES.values():
        assert "do not follow" in desc.lower()
        assert "do not paginate" in desc.lower() or "do not follow pagination" in desc.lower()
        assert "size" in desc.lower()
        assert "never guess" in desc.lower()


def test_the_template_follows_from_how_the_catalogue_is_reached():
    assert studio.seed_kind({"method": "sitemap-bounded"}) == "product-page"
    assert studio.seed_kind({"method": "sitemap"}) == "product-page"
    assert studio.seed_kind({"method": "shopify"}) == "listing-page"
    assert studio.seed_kind({"method": "shopify",
                             "studio": {"template": "product-page"}}) == "product-page"


# --- the collector registry ---------------------------------------------------

def test_a_recorded_collector_is_not_recreated():
    """Create is not idempotent and the CLI has no `scraper list`, so a careless
    re-run orphans a collector that can then only be found in the web UI."""
    desc = studio.TEMPLATES["product-page"]
    reg = {"collectors": {"s": {"collector_id": "c_abc1234567",
                                "description_sha": studio.description_sha(desc)}}}
    assert studio.needs_creation(reg, "s", desc, force=False) is False


def test_a_changed_description_forces_a_rebuild():
    reg = {"collectors": {"s": {"collector_id": "c_abc1234567",
                                "description_sha": "sha256:stale"}}}
    assert studio.needs_creation(reg, "s", studio.TEMPLATES["product-page"], False) is True


def test_a_failed_collector_is_retried_and_an_unknown_store_is_created():
    desc = studio.TEMPLATES["product-page"]
    reg = {"collectors": {"s": {"collector_id": "c_abc1234567", "status": "failed",
                                "description_sha": studio.description_sha(desc)}}}
    assert studio.needs_creation(reg, "s", desc, False) is True
    assert studio.needs_creation({"collectors": {}}, "new", desc, False) is True


def test_the_collector_registry_is_not_gitignored():
    """studio-*.json in .gitignore silently swallowed this file, which is the most
    plausible reason the first three collectors' descriptions were lost. There is no
    way to list collectors from the CLI, so losing this file loses the fleet."""
    out = subprocess.run(
        ["git", "check-ignore", "-v", "--", str(studio.REGISTRY)],
        capture_output=True, text=True, cwd=HERE)
    # check-ignore prints the matching pattern; a leading '!' means explicitly not
    # ignored. No match at all is also fine.
    if out.stdout.strip():
        pattern = out.stdout.split("\t")[0].split(":")[-1]
        assert pattern.startswith("!"), f"matched by {pattern}, which would ignore it"


# --- price coercion -----------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    (4.49, 4.49),
    ("4.49", 4.49),
    ("$4.49", 4.49),
    ("PHP 389.50", 389.50),
    ("1,234.00", 1234.00),
    ("₱378", 378.0),
])
def test_studio_prices_arrive_as_strings_and_are_coerced(raw, expected):
    assert studio.coerce_price(raw) == pytest.approx(expected)


@pytest.mark.parametrize("raw", ["Price on request", "", None, 0, -3, "call us"])
def test_an_uncoercible_price_is_dropped_not_guessed(raw):
    assert studio.coerce_price(raw) is None


# --- product identity ---------------------------------------------------------

def test_the_product_key_comes_from_the_url_not_the_collector():
    """The most expensive bug available here. If Studio keyed on a SKU while the puller
    keyed on the slug, the first fallback run would report the whole catalogue as new
    and overwrite the price history - the one thing that cannot be re-collected."""
    raw = [{"url": "https://x.test/products/rice-5kg", "product_key": "SKU-99887",
            "name": "Great Value Rice 5kg", "price": "₱378", "currency": "PHP"}]
    rows = studio.studio_rows({"id": "s", "country": "PH"}, raw, cat.row)
    assert rows[0]["product_key"] == "rice-5kg"


def test_studio_rows_carry_the_same_shape_the_puller_produces():
    raw = [{"url": "https://x.test/products/oil-1-5l", "name": "Canola Oil",
            "price": "PHP 115.00", "currency": "PHP", "size": "1.5L", "in_stock": True}]
    rows = studio.studio_rows({"id": "s", "country": "PH"}, raw, cat.row)
    r = rows[0]
    assert r["size"]["quantity"] == pytest.approx(1500.0)
    assert r["unit_price"]["basis"] == "per_litre"
    assert r["source"] == "studio"
    assert set(r) == set(cat.row("s", "PH", product_key="k", name="n", price=1.0,
                                 currency="PHP", url="u"))


def test_the_echoed_input_field_is_not_treated_as_data():
    """Bright Data echoes the trigger payload back on every row."""
    raw = [{"url": "https://x.test/products/a", "name": "Rice 1kg", "price": 50.0,
            "input": {"url": "https://x.test/products/a"}}]
    rows = studio.studio_rows({"id": "s", "country": "PH"}, raw, cat.row)
    assert "input" not in rows[0]


def test_rows_without_a_url_or_a_name_are_dropped():
    raw = [{"name": "No URL", "price": 5.0},
           {"url": "https://x.test/products/a", "price": 5.0},
           {"url": "https://x.test/products/b", "name": "Fine", "price": 5.0}]
    rows = studio.studio_rows({"id": "s", "country": "PH"}, raw, cat.row)
    assert len(rows) == 1 and rows[0]["name"] == "Fine"


# --- bounding -----------------------------------------------------------------

def test_the_batch_refuses_an_empty_url_list():
    """A run with no URLs would spend a trigger for nothing."""
    import asyncio
    with pytest.raises(studio.StudioEmpty):
        asyncio.run(studio.run_batch("c_x", [], Path("/tmp/never-written.json")))


def test_timeouts_are_attempt_counts_matched_to_the_polling_interval():
    """The CLI's poll loop is `for attempt < timeout` with a 10s batch interval, so the
    default of 3600 polls for ten hours. These constants are wall-clock budgets."""
    assert studio.BATCH_ATTEMPTS * 10 <= 30 * 60
    assert studio.SYNC_TIMEOUT <= 50


def test_a_product_page_row_takes_its_url_from_the_echoed_input():
    """Found by the pilot. A product-page collector has no reason to emit a url field -
    the page it was handed is the product - so the echoed trigger payload is the only
    URL there is. Dropping the echo wholesale threw away every row."""
    raw = [{"name": "Baguio Canola Oil 1.5L", "price": "PHP 115.00", "currency": "PHP",
            "input": {"url": "https://www.landers.ph/list/baguio-canola-oil-1-5l-115977-6990"}}]
    rows = studio.studio_rows({"id": "ph-landers", "country": "PH"}, raw, cat.row)
    assert len(rows) == 1
    assert rows[0]["product_key"] == "baguio-canola-oil-1-5l-115977-6990"
    assert "input" not in rows[0]


def test_an_explicit_url_still_wins_over_the_echo():
    raw = [{"url": "https://x.test/products/real", "name": "Rice", "price": 50.0,
            "input": {"url": "https://x.test/collections/all?page=1"}}]
    rows = studio.studio_rows({"id": "s", "country": "PH"}, raw, cat.row)
    assert rows[0]["product_key"] == "real"


# --- size reconciliation ------------------------------------------------------

def _rows(raw):
    import basket
    return studio.studio_rows({"id": "s", "country": "PH"}, raw, cat.row,
                              parse_size=basket.parse_size, no_size=cat.NO_SIZE)


def test_a_truncated_collector_size_yields_no_unit_price_rather_than_a_wrong_one():
    """From the pilot: a collector returned "1G" for "Baguio Pure Coconut Oil 1Gal.".
    That parses cleanly as one gram and priced the oil at PHP 799,950 per kilo. A
    missing unit price is a visible gap; a wrong one poisons every comparison."""
    raw = [{"url": "https://x.test/products/coconut-oil-1gal",
            "name": "Baguio Pure Coconut Oil 1Gal.", "price": 799.95,
            "currency": "PHP", "size": "1G"}]
    r = _rows(raw)[0]
    assert r["size"] is None
    assert r["unit_price"] is None


def test_an_agreeing_size_is_kept():
    raw = [{"url": "https://x.test/products/oil", "name": "Canola Oil 1.5L",
            "price": 228.0, "currency": "PHP", "size": "1.5L"}]
    r = _rows(raw)[0]
    assert r["unit_price"]["value"] == pytest.approx(152.0)


def test_a_size_the_title_does_not_mention_is_still_trusted():
    """Sizes often live in the specifications rather than the title. Only a genuine
    disagreement is a conflict; silence is not."""
    raw = [{"url": "https://x.test/products/rice", "name": "Great Value Rice",
            "price": 378.0, "currency": "PHP", "size": "5kg"}]
    r = _rows(raw)[0]
    assert r["size"]["quantity"] == pytest.approx(5000.0)
    assert r["unit_price"]["value"] == pytest.approx(75.6)
