-- Philippines only. The US stores stay as rows, and their runs, products and
-- price observations stay with them; `active = false` is what keeps all of it
-- out of the pulls, the index, the rails and the catalogue search.
UPDATE stores SET active = false, index_contributor = false WHERE country = 'US';
--> statement-breakpoint
-- The PH clone storefront now serves a sitemap and JSON-LD product pages, so
-- the sitemap adapter reads it like any other store. max_pages counts the
-- sitemap fetch itself plus one fetch per product; 20 leaves room above the
-- ten products so ceiling_reached stays honest.
UPDATE stores
SET method = 'sitemap',
    endpoint = 'https://pantry.spencerjireh.com/ph/sitemap.xml',
    max_pages = 20
WHERE store_id = 'clone-parkers-pantry-ph';
