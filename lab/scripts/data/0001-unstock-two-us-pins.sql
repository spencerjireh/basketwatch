-- Two US pins that are not the item they stand for.
--
-- Run by hand against a database; deliberately NOT a drizzle migration. Pins are
-- curated data and the quality gate owns them, so putting an edit to basket_map
-- in the auto-applied migration path would fight whatever that gate decides.
--
-- Both are marked not_stocked rather than repointed, because neither store
-- carries the real item at all:
--
--   us-mexgrocer chicken -> "Juanita's Chicken Pozole - 25 oz", a canned soup.
--     MexGrocer's whole chicken catalogue is pozole, bouillon and soup; there is
--     no chicken meat to repoint to.
--   us-latimex bread -> "Amafil Cheese Bread Mix - 1kg", a baking mix.
--     Latimex sells cornmeal, breadcrumbs and cassava bread. No loaf.
--
-- Neither is caught by any automatic flag: both parse cleanly and both are
-- cheap, so they win the unit-price ranking rather than tripping the outlier
-- rule. Ranking by unit price is what made them visible, and printing the
-- product name on the receipt is what keeps them visible.
--
-- Effect: US bread moves to Kesar Grocery's "100% Whole Wheat Bread (24 Oz.)"
-- at $9.54/kg, an actual loaf. US chicken moves to Sukli's chicken longganisa at
-- $21.94/kg -- a chicken product sold by weight, which is an improvement on
-- canned soup but still not chicken breast. No index-contributing US store
-- stocks chicken breast; that is a coverage gap, not a pin error.

update basket_map
set status = 'not_stocked',
    why = 'canned soup, not chicken meat; MexGrocer carries no chicken to repoint to'
where item_key = 'chicken' and store_id = 'us-mexgrocer';

update basket_map
set status = 'not_stocked',
    why = 'a baking mix, not a loaf; Latimex carries no bread to repoint to'
where item_key = 'bread' and store_id = 'us-latimex';
