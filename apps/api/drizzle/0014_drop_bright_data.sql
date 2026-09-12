-- Bright Data is gone: no Scraper Studio collectors, no Web Unlocker, no heal
-- loop. This drops the tables and columns that only existed for them, adds the
-- `active` switch on stores, and points every store at the adapter that reads
-- it directly.
--
-- Incident rows keep their studio_* kinds (the contract lists them as legacy)
-- so the record of what broke during the Studio era still renders.

-- latest_price is `select *` over price_observations, so Postgres refuses to
-- drop a column out from under it. Recreated at the end, minus `source`.
DROP VIEW latest_price;
--> statement-breakpoint
DROP TABLE scraper_templates;
--> statement-breakpoint
DROP TABLE heal_attempts;
--> statement-breakpoint
ALTER TABLE runs DROP CONSTRAINT runs_attached_to_something;
--> statement-breakpoint
ALTER TABLE stores
  DROP COLUMN studio_collector_id,
  DROP COLUMN needs_browser,
  DROP COLUMN needs_unlocker,
  DROP COLUMN studio_endpoint;
--> statement-breakpoint
ALTER TABLE runs
  DROP COLUMN scraper_id,
  DROP COLUMN transport,
  DROP COLUMN source,
  DROP COLUMN credits_usd,
  DROP COLUMN raw_output;
--> statement-breakpoint
ALTER TABLE incidents DROP COLUMN scraper_id;
--> statement-breakpoint
DROP TABLE scrapers;
--> statement-breakpoint
ALTER TABLE price_observations DROP COLUMN source;
--> statement-breakpoint
-- Same definition as 0000: ordered by id rather than observed_at because two
-- observations can share a timestamp and a tie would return both rows.
CREATE VIEW "latest_price" AS
SELECT DISTINCT ON ("store_id", "product_key") *
FROM "price_observations"
ORDER BY "store_id", "product_key", "id" DESC;
--> statement-breakpoint
-- Off means: keep the history, pull nothing, show nothing.
ALTER TABLE stores ADD COLUMN active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
-- Migration 0011 moved these stores onto Studio's sitemap collectors and left
-- their direct endpoints in place. Route them back to the adapter that reads
-- the endpoint they still carry.
UPDATE stores SET method = 'shopify' WHERE endpoint LIKE '%/products.json';
--> statement-breakpoint
UPDATE stores
SET method = 'magento-graphql',
    endpoint = coalesce(endpoint, 'https://smmarkets.ph/graphql')
WHERE store_id = 'ph-smmarkets';
--> statement-breakpoint
-- sitemap-bounded never meant anything beyond max_pages, which the sitemap
-- adapter already honours.
UPDATE stores SET method = 'sitemap' WHERE method = 'sitemap-bounded';
--> statement-breakpoint
-- No endpoint, no adapter: the Studio-only stores (browser-rendered sites,
-- the clone storefronts' listing pages) are parked until one exists. The
-- pullable filter is `method <> 'none'`, so this is what keeps the schedule
-- from opening an incident against each of them every morning.
UPDATE stores SET method = 'none' WHERE endpoint IS NULL AND method <> 'none';
--> statement-breakpoint
-- 'healing' was the heal loop's in-flight state. Nothing will move these
-- incidents on, so they go back to open, where the validator can resolve them
-- on the next healthy run.
UPDATE incidents SET state = 'open' WHERE state = 'healing';
