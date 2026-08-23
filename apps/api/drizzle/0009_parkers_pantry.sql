-- Parker's Pantry: the disclosed clone store, one storefront per country.
--
-- Reference data, in the migration, for the same reason the items rows are
-- (0002): the deploy pulls main and runs compose, and there is no step where
-- a human runs a seed script. Two stores so the comparison view keeps one
-- always-up source per country that cannot go down with a third-party site.
-- Both launch with index_contributor false: a fake store must not move the
-- real index unless someone deliberately flips it in
-- (POST /api/fleet/:id/index-contributor).
--
-- method 'listing' takes the Studio adapter's paginated-listing path with
-- max_pages 1, so the collector sees exactly <studio_endpoint>?page=1.
-- Product rows are seeded here (not left to the first pull) because
-- basket_map's FK needs them, and the keys are ours to choose -- the puller
-- derives the same keys from the product URLs' last path segment.
INSERT INTO "stores"
  (store_id, name, country, currency, method, endpoint, studio_endpoint,
   max_pages, coverage, coverage_reason, index_contributor,
   needs_browser, needs_unlocker)
VALUES
  ('clone-parkers-pantry-us', 'Parker''s Pantry (US)', 'US', 'USD', 'listing',
   NULL, 'https://pantry.spencerjireh.com/us', 1, 'full',
   'Disclosed demo rig: our own storefront, all 10 staples on one page.',
   false, false, false),
  ('clone-parkers-pantry-ph', 'Parker''s Pantry (PH)', 'PH', 'PHP', 'listing',
   NULL, 'https://pantry.spencerjireh.com/ph', 1, 'full',
   'Disclosed demo rig: our own storefront, all 10 staples on one page.',
   false, false, false)
ON CONFLICT (store_id) DO NOTHING;--> statement-breakpoint
INSERT INTO "products"
  (store_id, product_key, name, url, unit, size_value, size_uom,
   size_quantity, size_base_uom, size_form, size_approximate,
   first_seen, last_seen)
SELECT
  s.store_id,
  c.key,
  c.name,
  'https://pantry.spencerjireh.com/' || s.slug || '/products/' || c.key,
  c.unit, c.size_value, c.size_uom, c.size_quantity, c.size_base_uom,
  c.size_form, false, now(), now()
FROM (VALUES
  ('clone-parkers-pantry-us', 'us'),
  ('clone-parkers-pantry-ph', 'ph')
) AS s(store_id, slug)
CROSS JOIN (VALUES
  ('eggs-12',     'Farm Fresh Large Eggs 12 ct',      '12 ct',    12.0, 'ct',   12.0,    'count', 'plain'),
  ('milk-1g',     'Whole Milk 1 gal',                 '1 gal',     1.0, 'gal',  3785.41, 'ml',    'plain'),
  ('bread-loaf',  'Classic White Bread 20 oz',        '20 oz',    20.0, 'oz',   566.99,  'g',     'plain'),
  ('rice-5lb',    'Long Grain White Rice 5 lb',       '5 lb',      5.0, 'lb',   2267.96, 'g',     'plain'),
  ('coffee-12oz', 'House Blend Ground Coffee 12 oz',  '12 oz',    12.0, 'oz',   340.19,  'g',     'plain'),
  ('sugar-4lb',   'Granulated Sugar 4 lb',            '4 lb',      4.0, 'lb',   1814.37, 'g',     'plain'),
  ('chicken-lb',  'Chicken Breast 1 lb',              '1 lb',      1.0, 'lb',   453.59,  'g',     'plain'),
  ('oil-48oz',    'Vegetable Oil 48 fl oz',           '48 fl oz', 48.0, 'floz', 1419.53, 'ml',    'volume'),
  ('pasta-1lb',   'Spaghetti Pasta 1 lb',             '1 lb',      1.0, 'lb',   453.59,  'g',     'plain'),
  ('bananas-lb',  'Bananas 1 lb',                     '1 lb',      1.0, 'lb',   453.59,  'g',     'plain')
) AS c(key, name, unit, size_value, size_uom, size_quantity, size_base_uom, size_form)
ON CONFLICT (store_id, product_key) DO NOTHING;--> statement-breakpoint
-- Pins for the canonical basket. WHERE EXISTS keeps boot alive on a fresh
-- database whose items table was never loaded (items came from the one-time
-- lab loader, not a migration) -- there the pins simply do not seed.
INSERT INTO "basket_map"
  (item_key, store_id, product_key, url, status, via, why, picked_at)
SELECT
  m.item_key,
  s.store_id,
  m.product_key,
  'https://pantry.spencerjireh.com/' || s.slug || '/products/' || m.product_key,
  'curated',
  'manual',
  'Disclosed demo rig: pinned by construction, the storefront sells exactly these staples.',
  now()
FROM (VALUES
  ('clone-parkers-pantry-us', 'us'),
  ('clone-parkers-pantry-ph', 'ph')
) AS s(store_id, slug)
CROSS JOIN (VALUES
  ('rice',        'rice-5lb'),
  ('bread',       'bread-loaf'),
  ('milk',        'milk-1g'),
  ('eggs',        'eggs-12'),
  ('sugar',       'sugar-4lb'),
  ('chicken',     'chicken-lb'),
  ('cooking_oil', 'oil-48oz'),
  ('pasta',       'pasta-1lb'),
  ('bananas',     'bananas-lb'),
  ('coffee',      'coffee-12oz')
) AS m(item_key, product_key)
WHERE EXISTS (SELECT 1 FROM "items" i WHERE i."key" = m.item_key)
ON CONFLICT (item_key, store_id) DO NOTHING;
