-- The basket grows from ten staples to fifteen.
--
-- Nothing here is new curation: these five already sit in `items` as `stretch`,
-- already carry verified pins picked from the same catalogues, and already
-- render on /behind's rails. What they lacked was an index quantity, because
-- only the core ten had one. Promoting a tier is the whole change.
--
-- The rule the index enforces -- a day that cannot price every core item scores
-- no total -- makes this an all-or-nothing commitment across BOTH countries,
-- since `expected` is the core item count cross-joined to each country. Each of
-- these five was checked against live production data first: every one has at
-- least two priced, correctly-based, sized pins at index-contributing stores in
-- each of US and PH -- better coverage than bananas, which the basket has been
-- carrying on a single Philippine pin since day one.
--
-- Quantities follow each item's own target_size, so the basket reads as a
-- shopping list rather than an arbitrary weighting: a kilo each of the fresh
-- proteins and onions, a half-kilo of cheese, one tin of sardines. index_uom
-- must satisfy items_index_uom_matches_normal_unit (normal_unit g -> kg).
UPDATE "items" AS i
SET "tier" = 'core',
    "index_quantity" = v.qty,
    "index_uom" = v.uom
FROM (VALUES
  ('pork',        1.0,   'kg'),
  ('fish',        1.0,   'kg'),
  ('onions',      1.0,   'kg'),
  ('cheese',      0.5,   'kg'),
  ('canned_fish', 0.155, 'kg')
) AS v(key, qty, uom)
WHERE i."key" = v.key AND i."tier" = 'stretch';
