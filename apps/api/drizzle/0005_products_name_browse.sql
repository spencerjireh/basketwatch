-- The browse order for /prices with an empty search box.
--
-- name first, then the primary key, so the ORDER BY and the keyset seek are the
-- same three columns the index is built on. Postgres can then walk it and stop
-- at the page size. Without it, the alternative is a sequential scan of every
-- product, the latest-price lateral evaluated for all of them, and a sort of
-- the whole catalogue -- on every page, including every "Show more".
--
-- Not CONCURRENTLY: this runs inside the migration transaction, and 28k rows is
-- milliseconds. Same reasoning as idx_products_name_trgm in 0002.
CREATE INDEX IF NOT EXISTS "idx_products_name_browse"
  ON "products" USING btree ("name", "store_id", "product_key");
