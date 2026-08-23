-- The fleet converts to the recipe that works. Listing-page collectors were
-- 0-for-8 at ~$2.19 a run inside our 12-minute deadline (their runs kept
-- grinding for hours after the CLI walked away); the product-page recipe
-- (us-dierbergs) delivers in minutes at cents. The ten abandoned Shopify
-- stores move to sitemap discovery, and ph-smmarkets -- whose live collector
-- was already product-page -- stops being fed listing grid URLs.
UPDATE stores
SET method = 'sitemap',
    studio_endpoint = replace(endpoint, '/products.json', '/sitemap.xml'),
    max_pages = 300
WHERE store_id IN (
  'ph-ever', 'ph-shopgaisano', 'ph-shopsuki',
  'us-amigofoods', 'us-cypressindian', 'us-latimex', 'us-lilimart',
  'us-mexgrocer', 'us-mexmax', 'us-sukli'
)
AND endpoint LIKE '%/products.json';

UPDATE stores
SET method = 'sitemap',
    studio_endpoint = 'https://smmarkets.ph/sitemap.xml',
    max_pages = 300
WHERE store_id = 'ph-smmarkets';

-- The six product-page collectors created from the local stack on Aug 23.
-- Collectors are account-level at Bright Data, so prod uses them as-is.
INSERT INTO scrapers (id, name, target_site, output_schema, status)
VALUES
  ('c_mt5q0jzi18h73rtbha', 'basketwatch-ph-shopsuki',     'https://shopsuki.ph',              '[]'::jsonb, 'healthy'),
  ('c_mt5sf35quefc5u6s8',  'basketwatch-us-amigofoods',   'https://www.amigofoods.com',       '[]'::jsonb, 'healthy'),
  ('c_mt5sf1hn2gm0alggzg', 'basketwatch-us-cypressindian','https://cypressindiangrocery.com', '[]'::jsonb, 'healthy'),
  ('c_mt5sf4te2nl1om58n6', 'basketwatch-us-latimex',      'https://latimexmarket.com',        '[]'::jsonb, 'healthy'),
  ('c_mt5si8vp2cd0f03mfp', 'basketwatch-us-lilimart',     'https://shoplilimart.com',         '[]'::jsonb, 'healthy'),
  ('c_mt5siakh3td7a3dk1',  'basketwatch-us-mexgrocer',    'https://www.mexgrocer.com',        '[]'::jsonb, 'healthy')
ON CONFLICT (id) DO NOTHING;

UPDATE stores SET studio_collector_id = 'c_mt5q0jzi18h73rtbha'  WHERE store_id = 'ph-shopsuki';
UPDATE stores SET studio_collector_id = 'c_mt5sf35quefc5u6s8'   WHERE store_id = 'us-amigofoods';
UPDATE stores SET studio_collector_id = 'c_mt5sf1hn2gm0alggzg'  WHERE store_id = 'us-cypressindian';
UPDATE stores SET studio_collector_id = 'c_mt5sf4te2nl1om58n6'  WHERE store_id = 'us-latimex';
UPDATE stores SET studio_collector_id = 'c_mt5si8vp2cd0f03mfp'  WHERE store_id = 'us-lilimart';
UPDATE stores SET studio_collector_id = 'c_mt5siakh3td7a3dk1'   WHERE store_id = 'us-mexgrocer';

-- These four still point at retired listing-page collectors; nulling the id
-- lets a future provision create their product-page replacements. Their
-- Aug 23 data arrived via the salvaged listing datasets (migration 0012),
-- so nothing is lost by leaving them unprovisioned tonight.
UPDATE stores SET studio_collector_id = NULL
WHERE store_id IN ('ph-ever', 'ph-shopgaisano', 'us-mexmax', 'us-sukli');
