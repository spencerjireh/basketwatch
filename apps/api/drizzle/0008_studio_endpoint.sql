-- Separate endpoint for Studio scrapers. Studio scrapes HTML product listing
-- pages, not the JSON API endpoints stored in `endpoint`. Both columns coexist
-- so the HTTP fallback path keeps working.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS studio_endpoint TEXT;

-- Shopify stores: Studio visits /collections/all, not /products.json.
UPDATE stores SET studio_endpoint = replace(endpoint, '/products.json', '/collections/all')
WHERE method = 'shopify' AND endpoint LIKE '%/products.json';

-- Magento GraphQL: Studio visits the category page, not the GraphQL endpoint.
UPDATE stores SET studio_endpoint = 'https://smmarkets.ph/groceries.html'
WHERE store_id = 'ph-smmarkets';

-- Sitemap stores: studio_endpoint is the sitemap URL used for product URL
-- discovery. The Studio adapter discovers product URLs from the sitemap, then
-- feeds them to a product-page collector.
UPDATE stores SET studio_endpoint = 'https://www.dierbergs.com/sitemap.xml'
WHERE store_id = 'us-dierbergs';
UPDATE stores SET studio_endpoint = 'https://www.hmart.com/sitemap.xml'
WHERE store_id = 'us-hmart';
UPDATE stores SET studio_endpoint = 'https://www.kesargrocery.com/sitemap.xml'
WHERE store_id = 'us-kesargrocery';
UPDATE stores SET studio_endpoint = 'https://www.landers.ph/sitemap.xml'
WHERE store_id = 'ph-landers';
-- ph-merrymartwholesale has no sitemap; left NULL. Its product URLs are
-- discovered by crawling categories from the homepage (out of scope for now).
