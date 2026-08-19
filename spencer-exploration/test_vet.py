# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest", "httpx[http2]"]
# ///
"""Tests for the pure vetting logic.

Every case here is a bug this harness actually shipped during the exploration,
or a boundary that decides a site's verdict. Run:

    uv run --with pytest pytest spencer-exploration/test_vet.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from vet import (  # noqa: E402
    basket_match,
    classify,
    parse_robots,
    parse_sitemap,
    product_score,
    robots_blocks,
    structural_class,
)


# --- robots.txt ---------------------------------------------------------------
# The first version split each rule on "*" and prefix-matched, so "/*/cart/"
# collapsed to "/" and excluded five otherwise-good sites.

def test_wildcard_rule_does_not_block_everything():
    assert not robots_blocks("/products/rice-5kg", ["/*/cart/", "/*/checkout"])


def test_wildcard_still_blocks_what_it_names():
    assert robots_blocks("/en/cart/", ["/*/cart/"])


def test_root_disallow_blocks_everything():
    assert robots_blocks("/products/anything", ["/"])


def test_empty_disallow_means_allow_all():
    # "Disallow:" with no value is the permissive form; parse_robots drops it.
    parsed = parse_robots("User-agent: *\nDisallow:\n")
    assert parsed["disallow_star"] == []
    assert not robots_blocks("/products/x", parsed["disallow_star"])


def test_allow_overrides_less_specific_disallow():
    assert not robots_blocks("/shop/products/x", ["/shop"], ["/shop/products"])


def test_disallow_wins_when_more_specific():
    assert robots_blocks("/shop/private/x", ["/shop/private"], ["/shop"])


def test_equal_length_tie_goes_to_allow():
    assert not robots_blocks("/shop/x", ["/shop"], ["/shop"])


def test_only_star_group_is_read():
    parsed = parse_robots(
        "User-agent: Googlebot\nDisallow: /everything\n\nUser-agent: *\nDisallow: /admin\n"
    )
    assert parsed["disallow_star"] == ["/admin"]


def test_consecutive_agent_lines_share_a_group():
    parsed = parse_robots("User-agent: Bingbot\nUser-agent: *\nDisallow: /admin\n")
    assert parsed["disallow_star"] == ["/admin"]


def test_sitemap_lines_are_harvested_outside_any_group():
    parsed = parse_robots("Sitemap: https://x.test/sitemap.xml\nUser-agent: *\nDisallow:\n")
    assert parsed["sitemaps"] == ["https://x.test/sitemap.xml"]


def test_dollar_anchor_is_respected():
    assert robots_blocks("/a.json", ["/*.json$"])
    assert not robots_blocks("/a.json.html", ["/*.json$"])


# --- product URL selection ----------------------------------------------------
# The harness first probed Sprouts recipe pages and Dierbergs recall notices,
# then reported the sites as client-rendered because those pages carry no price.

@pytest.mark.parametrize("url", [
    "https://x.test/healthy-living/recipes-for-leftover-hard-boiled-eggs/",
    "https://x.test/pages/product-recall-lewis-artisan-bread-allergen",
    "https://x.test/blog/how-to-cook-rice",
    "https://x.test/categories/dairy-1",
    "https://x.test/images/banner.png",
    "https://x.test/home-page-grocery-outlet/012126_eggs_websitebanner_",
    "https://x.test/products/category-hero-image-2026",
    "https://x.test/",
])
def test_non_product_urls_are_not_probed(url):
    assert product_score(url, []) < 3


@pytest.mark.parametrize("url", [
    "https://x.test/products/great-value-v-160-rice-5kg",
    "https://x.test/item/bakehouse-italian-supremo-bread-37509",
    "https://x.test/anti-hoarding-list/baguio-canola-oil-1-5l-115977-6990",
])
def test_real_product_urls_are_probed(url):
    assert product_score(url, []) >= 3


def test_size_token_outranks_a_bare_slug():
    sized = product_score("https://x.test/products/canola-oil-1-5l", [])
    plain = product_score("https://x.test/products/canola-oil", [])
    assert sized > plain


def test_hint_boosts_matching_paths():
    with_hint = product_score("https://x.test/products/abc-def-ghi", ["/products/"])
    without = product_score("https://x.test/products/abc-def-ghi", [])
    assert with_hint > without


# --- basket matching ----------------------------------------------------------
# Round 1 mapped a toy "surprise egg" to eggs and a baby lotion to milk.

@pytest.mark.parametrize("url,expected", [
    ("https://x.test/products/great-value-v-160-rice-5kg", "rice"),
    ("https://x.test/products/bear-brand-powdered-milk-drink-320g", "milk"),
    ("https://x.test/products/ufc-hapi-fiesta-canola-oil-blend-900ml", "cooking_oil"),
    ("https://x.test/products/bigas-premium-25kg", "rice"),
])
def test_basket_items_are_recognised(url, expected):
    assert basket_match(url) == expected


@pytest.mark.parametrize("url", [
    "https://x.test/products/rainbocorns-ultimate-surprise-egg-series-2-purple-horn",
    "https://x.test/products/sisley-paris-lyslait-cleansing-milk-with-white-lily",
    "https://x.test/products/hydrite-banana-4-1-g-granules-for-solution",
    "https://x.test/products/solid-oak-coffee-table",
])
def test_non_grocery_lookalikes_are_rejected(url):
    assert basket_match(url) is None


def test_match_is_deterministic_when_a_slug_names_two_items():
    # "milk" precedes "coffee" in BASKET, and that order is the contract.
    assert basket_match("https://x.test/products/milk-coffee-blend-200g") == "milk"


# --- sitemaps -----------------------------------------------------------------

def test_urlset_returns_pages():
    pages, nested = parse_sitemap(
        '<?xml version="1.0"?><urlset><url><loc>https://x.test/a</loc></url></urlset>'
    )
    assert pages == ["https://x.test/a"] and nested == []


def test_sitemapindex_returns_nested_only():
    pages, nested = parse_sitemap(
        '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://x.test/s1.xml</loc></sitemap></sitemapindex>'
    )
    assert pages == [] and nested == ["https://x.test/s1.xml"]


def test_plain_text_sitemap():
    pages, nested = parse_sitemap("https://x.test/a\nhttps://x.test/b\n\nnot-a-url\n")
    assert pages == ["https://x.test/a", "https://x.test/b"] and nested == []


# --- classification -----------------------------------------------------------

def _resp(status=200, body="", err=None):
    return {"status": status, "body": body, "bytes": len(body), "error": err}


def test_http_403_is_blocked():
    assert classify(_resp(403))["class"] == "blocked"


def test_connection_failure_is_blocked():
    assert classify(_resp(0, err="ConnectError: refused"))["class"] == "blocked"


def test_challenge_page_is_blocked_despite_200():
    assert classify(_resp(200, "<html><title>Just a moment...</title></html>"))["class"] == "blocked"


def test_empty_spa_shell_is_spa_empty():
    assert classify(_resp(200, "<html><div id='root'></div></html>"))["class"] == "spa_empty"


def test_jsonld_price_is_server_rendered():
    body = '<script type="application/ld+json">{"@type":"Product","offers":{"price":"3.99"}}</script>'
    out = classify(_resp(200, body))
    assert out["class"] == "server_rendered"
    assert structural_class(out["signals"]) == "json-ld"


def test_microdata_price_is_server_rendered():
    out = classify(_resp(200, '<span itemprop="price">3.99</span>'))
    assert out["class"] == "server_rendered"
    assert structural_class(out["signals"]) == "microdata"


def test_three_currency_strings_are_enough_without_structured_data():
    out = classify(_resp(200, "<p>PHP 378</p><p>PHP 1,095</p><p>PHP 42.50</p>"))
    assert out["class"] == "server_rendered"
    assert structural_class(out["signals"]) == "bare-html"


def test_single_digit_dollar_amounts_are_not_prices():
    # "$1 $2 $3" in body copy must not read as a priced page.
    assert classify(_resp(200, "<p>pick $1 or $2 or $3 today</p>"))["class"] == "spa_empty"


def test_peso_prices_without_cents_still_count():
    # Shop Gaisano prices look like "₱378" - requiring cents would have hidden them.
    out = classify(_resp(200, "<p>₱378</p><p>₱495</p><p>₱1,095</p>"))
    assert out["class"] == "server_rendered"


def test_read_page_with_no_price_is_spa_opaque_not_unknown():
    # We saw the page and it carries nothing - a different finding from never
    # having reached it, which is what the fleet lock distinguishes.
    out = classify(_resp(200, "<html><div id='root'></div></html>"))
    assert structural_class(out["signals"]) == "spa-opaque"


def test_blocked_page_yields_unknown_structure():
    out = classify(_resp(403))
    assert structural_class(out["signals"]) == "unknown"


def test_embedded_state_without_price_is_spa_with_state():
    out = classify(_resp(200, "<script>window.__NEXT_DATA__ = {}</script>"))
    assert out["class"] == "spa_empty"
    assert structural_class(out["signals"]) == "spa-with-state"
