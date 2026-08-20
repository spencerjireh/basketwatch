# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest", "httpx[http2]"]
# ///
"""Tests for basket selection and unit-price maths.

Unit price is the comparison primitive for the whole product, so the parsing that
feeds it is the highest-consequence code here: a wrong unit price is worse than a
missing one. Every case below is either a real product title seen during vetting or
a boundary that decides comparability.

    uv run --with pytest --with 'httpx[http2]' pytest lab/spencer-exploration/test_basket.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import basket  # noqa: E402
from basket import (  # noqa: E402
    CORE_ITEMS,
    ITEMS,
    category_verdict,
    flag_unit_price_outliers,
    must_terms,
    name_is_the_staple,
    parse_size,
    to_base,
    unit_price,
)


# --- the registry ------------------------------------------------------------

def test_core_tier_is_the_prd_basket():
    assert set(CORE_ITEMS) == {
        "rice", "eggs", "milk", "bread", "coffee",
        "sugar", "chicken", "cooking_oil", "pasta", "bananas",
    }


def test_twenty_items_are_tracked():
    assert len(ITEMS) == 20


def test_every_item_declares_a_base_unit_and_both_countries():
    for key, spec in ITEMS.items():
        assert spec["normal_unit"] in ("g", "ml", "count"), key
        assert set(spec["target_size"]) == {"US", "PH"}, key


def test_country_localised_match_terms():
    assert "bigas" in must_terms("rice", "PH")
    assert "bigas" not in must_terms("rice", "US")
    assert "rice" in must_terms("rice", "US")


# --- size parsing ------------------------------------------------------------

@pytest.mark.parametrize("text,quantity,base", [
    ("Great Value V-160 Rice 5KG", 5000.0, "g"),
    ("Golden Fiesta Canola Oil 1L", 1000.0, "ml"),
    ("Ichipan White Bread 600g", 600.0, "g"),
    ("Bottled Water 1.5 Liter", 1500.0, "ml"),
])
def test_plain_sizes(text, quantity, base):
    s = parse_size(text)
    assert s["quantity"] == pytest.approx(quantity) and s["base_uom"] == base


def test_fraction_is_not_read_as_its_denominator():
    # "Brown Sugar 1/4 Kg" was parsed as 4kg before this was fixed.
    s = parse_size("Great Value Brown Sugar 1/4 Kg")
    assert s["quantity"] == pytest.approx(250.0) and s["form"] == "fraction"


def test_multipack_multiplies_out():
    # "12 x 2g" is 24 g of coffee, not 12 of something.
    s = parse_size("Beanies Instant Coffee Sticks Variety Pack 12 x 2g")
    assert s["quantity"] == pytest.approx(24.0) and s["form"] == "multipack"


def test_range_takes_the_midpoint_and_says_it_is_approximate():
    s = parse_size("CBVG Baby Eggplant | 500g-600g")
    assert s["quantity"] == pytest.approx(550.0) and s["approximate"] is True


def test_approx_weight_is_marked_approximate():
    s = parse_size("Banana Cardava RS approx 1.4kg")
    assert s["quantity"] == pytest.approx(1400.0) and s["approximate"] is True


def test_count_forms():
    assert parse_size("Great Value Farm Fresh Eggs Medium 12's")["quantity"] == 12
    assert parse_size("JW Fresh Egg Medium 30pcs")["quantity"] == 30


def test_fluid_ounces_are_volume_not_mass():
    s = parse_size("Bio Nutrition Black Seed Oil 16 fl oz")
    assert s["base_uom"] == "ml" and s["quantity"] == pytest.approx(473.176, rel=1e-3)


def test_bare_ounces_are_mass():
    assert parse_size("Progresso Chicken 18.5oz")["base_uom"] == "g"


def test_bundle_of_unknown_contents_is_not_a_size():
    # "6 Pack" says how many bundles, not how much is in them - guessing here would
    # produce a confidently wrong unit price.
    assert parse_size("Organic Shirataki Rice, 6 Pack") is None
    assert parse_size("Avocado Oil, 2 Pack") is None


def test_no_size_at_all():
    assert parse_size("Artisan Baker White Bread") is None
    assert parse_size("") is None


def test_to_base_rejects_meaningless_units():
    assert to_base(3, "pack") is None
    assert to_base(2, "kg")["quantity"] == 2000.0


# --- unit price --------------------------------------------------------------

def test_per_kg_matches_hand_calculation():
    # Shop Gaisano rice: PHP 378 / 5 kg = PHP 75.60 per kg.
    up = unit_price(378.0, parse_size("Great Value V-160 Rice 5KG"))
    assert up["basis"] == "per_kg" and up["value"] == pytest.approx(75.60)


def test_per_litre():
    up = unit_price(177.0, parse_size("Golden Fiesta Canola Oil 1L"))
    assert up["basis"] == "per_litre" and up["value"] == pytest.approx(177.0)


def test_per_item():
    up = unit_price(125.0, parse_size("Farm Fresh Eggs Medium 12's"))
    assert up["basis"] == "per_item" and up["value"] == pytest.approx(10.4167, rel=1e-3)


def test_unit_price_absent_without_a_size_or_price():
    assert unit_price(10.0, None) is None
    assert unit_price(None, parse_size("Rice 5KG")) is None


def test_approximate_size_carries_through_to_unit_price():
    up = unit_price(140.0, parse_size("Banana Cardava approx 1.4kg"))
    assert up["approximate"] is True


# --- staple matching ---------------------------------------------------------

@pytest.mark.parametrize("item,name", [
    ("rice", "Great Value V-160 Rice 5KG"),
    ("milk", "Lactel Whole Milk 1L"),
    ("sugar", "Eagle Refined Sugar 1kg"),
    ("eggs", "JW Fresh Egg Medium 30pcs"),
])
def test_real_staples_match(item, name):
    assert name_is_the_staple(item, name, "PH")


@pytest.mark.parametrize("item,name", [
    ("pork", "Knorr Pork Cubes Savers 120g"),          # plural "Cubes" vs term "cube"
    ("apples", "Nestea Apple Litro 25g"),              # powdered drink
    ("bottled_water", "Plastic Water Bottle 1.6L"),    # empty bottle
    ("bananas", "UFC Banana Catsup 320g"),
    ("chicken", "Progresso Traditional Chicken & Sausage Gumbo"),
    ("bread", "Argentina Beef Loaf 150G"),
    ("rice", "Liviva Dried Shirataki Instant Rice"),
    ("sugar", "Mrs Taste Zero Sugar Ranch Dressing"),
])
def test_lookalikes_are_rejected(item, name):
    assert not name_is_the_staple(item, name, "PH")


def test_tagalog_terms_match_for_ph_only():
    assert name_is_the_staple("rice", "Sinandomeng Bigas 5kg", "PH")
    assert not name_is_the_staple("rice", "Sinandomeng Bigas 5kg", "US")


# --- category gating ---------------------------------------------------------

def test_category_path_overrides_a_tempting_name():
    # "Sugar Kids Girls' Grace Sandals" reads as sugar to a text matcher; its
    # category never does.
    assert category_verdict("sugar", "https://x.test/apparel/shoes/sugar-kids-sandals") == "bad"


def test_matching_category_is_good():
    assert category_verdict("rice", "https://x.test/food-cupboard/premium-rice-10kg") == "good"


def test_unknown_when_there_is_no_category_path():
    assert category_verdict("rice", "https://x.test/premium-rice-10kg") == "unknown"


# --- outlier flagging --------------------------------------------------------

def _store(country, item, value):
    return {
        "country": country,
        "items": {item: {"unit_price": {"value": value, "basis": "per_kg"}}},
    }


def test_outlier_flagged_against_peer_median():
    stores = [_store("PH", "coffee", 400.0), _store("PH", "coffee", 450.0),
              _store("PH", "coffee", 420.0), _store("PH", "coffee", 4749.75)]
    assert flag_unit_price_outliers(stores) == 1
    assert stores[3]["items"]["coffee"]["unit_price_outlier"]["ratio_to_peer_median"] > 4


def test_no_flagging_without_enough_peers():
    stores = [_store("PH", "coffee", 400.0), _store("PH", "coffee", 9999.0)]
    assert flag_unit_price_outliers(stores) == 0


def test_countries_are_compared_separately():
    stores = [_store("PH", "rice", 75.0), _store("PH", "rice", 80.0),
              _store("PH", "rice", 70.0), _store("PH", "rice", 78.0),
              _store("US", "rice", 3.0), _store("US", "rice", 3.5),
              _store("US", "rice", 3.2), _store("US", "rice", 3.1)]
    assert flag_unit_price_outliers(stores) == 0


# --- unit-family guard -------------------------------------------------------
# Catches lookalikes that word lists miss: bottled water is measured in ml, so a
# 200 g pick is the wrong product no matter what its title says.

from basket import unit_family_ok  # noqa: E402


def test_wrong_unit_family_is_rejected():
    assert not unit_family_ok("bottled_water", parse_size("Dried Salted Herring 200 G"))
    assert not unit_family_ok("oranges", parse_size("Royal Tru-Orange 330 ML"))


def test_right_unit_family_passes():
    assert unit_family_ok("bottled_water", parse_size("Wilkins Distilled Water 1.5L"))
    assert unit_family_ok("rice", parse_size("Sinandomeng Rice 5kg"))
    assert unit_family_ok("eggs", parse_size("Fresh Eggs 12's"))


def test_unparseable_size_is_not_treated_as_a_mismatch():
    assert unit_family_ok("bread", None)


# --- the size-required gate --------------------------------------------------
# SM Markets' catalogue answers "sugar" with girls' shoes and "coffee" with a tee in
# Dark Coffee. Neither states a pack size, and food sold by weight always does.

from basket import pick_is_usable, size_required  # noqa: E402


def test_weight_and_volume_items_require_a_size():
    assert size_required("sugar") and size_required("cooking_oil")
    assert not size_required("eggs")          # counted, not weighed


def test_sizeless_apparel_is_rejected_for_a_weighed_item():
    assert not pick_is_usable("sugar", "Sugar Kids Girls' Klaris Pumps", "PH")
    assert not pick_is_usable("coffee", "Maxwear Men's Tee in Dark Coffee", "PH")


def test_sized_staple_passes_all_gates():
    assert pick_is_usable("sugar", "Eagle Refined Sugar 1kg", "PH")
    assert pick_is_usable("rice", "Great Value V-160 Rice 5KG", "PH")


def test_counted_item_needs_no_size():
    assert pick_is_usable("eggs", "Farm Fresh Eggs Large", "PH")


# --- pack-size plausibility --------------------------------------------------
# Snacks named after staples are the residual false positive; pack size separates
# them where brand blocklists cannot.

from basket import size_is_plausible  # noqa: E402


@pytest.mark.parametrize("item,name", [
    ("onions", "Pringles Sweet Onion | 100g"),
    ("potatoes", "Piknik Potato Cheesy Cheese | 55g"),
    ("bananas", "Leslie Banana Thins Honey Dipped | 100g"),
    ("rice", "Hop Polvoron Crisped Rice | 104g 8pcs"),
    ("apples", "Blumies Fruit Snack Apple & Hibiscus | 60g"),
])
def test_snack_sized_packs_are_rejected(item, name):
    assert not size_is_plausible(item, parse_size(name))


@pytest.mark.parametrize("item,name", [
    ("rice", "Great Value V-160 Rice 5KG"),
    ("onions", "Red Onion 1kg"),
    ("tomatoes", "Elrich Tomato Baguio | 350g-400g"),
])
def test_staple_sized_packs_pass(item, name):
    assert size_is_plausible(item, parse_size(name))


def test_plausibility_is_skipped_when_no_size_parses():
    assert size_is_plausible("onions", None)


# --- bare-HTML extraction ----------------------------------------------------
# Kesar Grocery and MerryMart carry ~12,000 products between them and publish no
# structured data at all.

from basket import extract_bare_html  # noqa: E402


def test_bare_html_reads_heading_and_priced_element():
    html = """<h1>Zafarani Basmati Rice 20 LB</h1>
              <div class="product-price">$24.99</div>"""
    out = extract_bare_html(html)
    assert out["name"].startswith("Zafarani") and out["price"] == pytest.approx(24.99)


def test_bare_html_ignores_currency_outside_a_price_element():
    # "$5 off your first order" is not the product price.
    html = "<h1>Rice 5kg</h1><p>Save $5 today</p>"
    assert extract_bare_html(html) is None


def test_bare_html_needs_a_name():
    assert extract_bare_html('<div class="price">$9.99</div>') is None


def test_bare_html_falls_back_to_a_price_near_the_heading():
    # MerryMart labels nothing as a price; the product's own price follows its <h1>.
    html = "<h1>555 Carne Norte 100g</h1><div><span>₱45.50</span></div>"
    out = extract_bare_html(html)
    assert out["price"] == pytest.approx(45.50) and out["via"] == "bare-html-near-h1"


def test_near_heading_fallback_ignores_prices_far_down_the_page():
    html = "<h1>Item</h1>" + ("x" * 6000) + "<span>₱999.00</span>"
    assert extract_bare_html(html) is None


# --- picking from the catalogue ----------------------------------------------

def _row(name, category=None, size_from=None, price=100.0):
    """A catalogue row as build_store_from_catalogue shapes one."""
    return {"name": name, "category": category, "url": f"https://x.test/{name[:12]}",
            "price": price, "currency": "PHP",
            "size": basket.parse_size(size_from or name)}


def test_the_store_category_beats_a_closer_pack_size():
    """Ranking on size alone picked "Julie's Coffee Waffles 100g", filed under Wafers,
    over real coffee - because 100g sat nearer the target. The store's own shelf is the
    cheapest second opinion available."""
    rows = [_row("Julie's Coffee Waffles 100g", "Wafer Squares and Bars, Wafers"),
            _row("Fresh Pick Barako Coffee Beans 250g", "Coffee, Regular Coffee")]
    pick = basket.pick_from_catalogue("coffee", "PH", rows)
    assert "Barako" in pick["name"]


def test_a_product_with_no_category_still_beats_one_filed_elsewhere():
    """An unknown shelf is not evidence against; a contradicting shelf is."""
    rows = [_row("Something Coffee Waffles 250g", "Wafers"),
            _row("Generic Ground Coffee 250g", None)]
    pick = basket.pick_from_catalogue("coffee", "PH", rows)
    assert "Ground Coffee" in pick["name"]


def test_the_pack_closest_to_the_target_size_wins_within_a_shelf():
    rows = [_row("House Rice 25kg", "Rice"), _row("House Rice 5kg", "Rice"),
            _row("House Rice 1kg", "Rice")]
    pick = basket.pick_from_catalogue("rice", "PH", rows)   # PH target is 5 kg
    assert pick["name"].endswith("5kg")


def test_banana_heart_is_not_a_banana():
    """It is a vegetable, and items.json listed vegetables as an accepted banana
    category, so it outranked real fruit on size."""
    rows = [_row("Global Fresh Banana Heart White 1kg", "Fresh Vegetables"),
            _row("Sydarb Banana Saba 750g", "Fresh Fruits")]
    pick = basket.pick_from_catalogue("bananas", "PH", rows)
    assert "Saba" in pick["name"]


def test_offal_and_preserved_forms_are_not_the_staple():
    """Chicken feet, salted eggs and pork liver all priced nothing like the cut the
    index is meant to track, and all three were picked before this."""
    assert not basket.pick_is_usable("chicken", "Mamanok's Chicken Feet 1kg", "PH")
    assert not basket.pick_is_usable("eggs", "Sunshine Salted Egg 4s", "PH")
    assert not basket.pick_is_usable("pork", "Jupiter Pork Liver 500g", "PH")
    assert basket.pick_is_usable("chicken", "Mamanok's Chicken Wings 1kg", "PH")
    assert basket.pick_is_usable("eggs", "Bounty Fresh Eggs Omega3 10s", "PH")


def test_an_item_with_no_match_in_the_catalogue_returns_nothing():
    assert basket.pick_from_catalogue("rice", "PH", [_row("Dish Soap 500ml")]) is None


# --- wholesale pricing --------------------------------------------------------

def _wholesale_store(pricing="retail", **items):
    st = {"id": "s", "name": "S", "country": "PH", "pricing": pricing, "items": {}}
    for k, v in items.items():
        st["items"][k] = v
    return st


def test_a_wholesale_store_keeps_its_price_but_gets_no_unit_price():
    """The listed price is per case while the title states the unit size, and the case
    count is unpublished for ~99% of these products. A wrong unit price silently poisons
    every comparison it feeds; a missing one is a visible gap."""
    entry = {"id": "s", "country": "PH", "pricing": "wholesale"}
    st = _wholesale_store("wholesale", rice={"name": "Jasmine Rice 5kg", "price": 2500.0,
                                   "currency": "PHP", "url": "u",
                                   "size": basket.parse_size("5kg"),
                                   "status": "verified"})
    st.update({"unresolved": []})
    out = basket.finalise(st, entry)
    assert out["items"]["rice"]["price"] == 2500.0
    assert out["items"]["rice"]["unit_price"] is None
    assert "case" in out["items"]["rice"]["pricing_note"]


def test_a_retail_store_still_gets_a_unit_price():
    entry = {"id": "s", "country": "PH", "pricing": "retail"}
    st = _wholesale_store("retail", rice={"name": "Jasmine Rice 5kg", "price": 250.0,
                                "currency": "PHP", "url": "u",
                                "size": basket.parse_size("5kg"),
                                "status": "verified"})
    st.update({"unresolved": []})
    out = basket.finalise(st, entry)
    assert out["items"]["rice"]["unit_price"]["value"] == pytest.approx(50.0)


def _peer(store_id, value, pricing="retail"):
    return {"id": store_id, "country": "PH", "pricing": pricing,
            "items": {"rice": {"unit_price": {"value": value, "basis": "per_kg"}}}}


def test_wholesale_prices_do_not_set_the_peer_median():
    """The failure this guards: case prices dragged the median up and correct retail rows
    were then flagged as too cheap. A $2.42/kg baking potato read as an outlier against a
    median set by potato gnocchi. 18 of 21 flags were this."""
    stores = [_peer("a", 50.0), _peer("b", 52.0), _peer("c", 48.0), _peer("d", 51.0),
              _peer("wholesale", 700.0, pricing="wholesale")]
    basket.flag_unit_price_outliers(stores)
    assert all("unit_price_outlier" not in s["items"]["rice"] for s in stores)


def test_a_genuine_outlier_among_retail_peers_is_still_flagged():
    stores = [_peer("a", 50.0), _peer("b", 52.0), _peer("c", 48.0), _peer("d", 900.0)]
    assert basket.flag_unit_price_outliers(stores) == 1
    assert "unit_price_outlier" in stores[3]["items"]["rice"]


def test_three_peers_are_too_few_to_flag_against():
    """The one false positive that survived the wholesale fix had exactly three peers,
    and two of them were the wrong shape of product."""
    stores = [_peer("a", 50.0), _peer("b", 52.0), _peer("c", 900.0)]
    assert basket.flag_unit_price_outliers(stores) == 0
