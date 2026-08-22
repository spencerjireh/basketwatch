-- Backfill incidents.scraper_id from stores.studio_collector_id where missing.
-- Two existing studio_failed incidents had NULL scraper_id because they were
-- created before the heal module set it. The heal repository filters on
-- incidents.scraper_id, so without this fix those incidents are invisible to it.
UPDATE incidents
SET scraper_id = s.studio_collector_id
FROM stores s
WHERE incidents.store_id = s.store_id
  AND incidents.scraper_id IS NULL
  AND s.studio_collector_id IS NOT NULL;
