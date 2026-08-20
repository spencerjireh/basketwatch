ALTER TABLE "items" ADD COLUMN "index_quantity" double precision;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "index_uom" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_index_uom_matches_normal_unit" CHECK (("items"."index_quantity" is null and "items"."index_uom" is null)
          or ("items"."index_quantity" > 0 and "items"."index_uom" = case "items"."normal_unit"
                when 'g' then 'kg' when 'ml' then 'l' else 'count' end));--> statement-breakpoint
-- The ten staples the basket is made of, and how much of each one basket buys.
--
-- Reference data, in the migration, for the same reason the items rows are: the
-- deploy is Coolify pulling main and running compose, and there is no step where
-- a human runs a seed script. A null index_quantity does not degrade gracefully
-- either -- it nulls the headline total on every day of the chart -- so shipping
-- the column without the values would be shipping a broken page.
UPDATE "items" AS i
SET "index_quantity" = v.qty, "index_uom" = v.uom
FROM (VALUES
  ('rice',        5.0,  'kg'),
  ('bread',       0.5,  'kg'),
  ('milk',        1.0,  'l'),
  ('eggs',       12.0,  'count'),
  ('sugar',       1.0,  'kg'),
  ('chicken',     1.0,  'kg'),
  ('cooking_oil', 1.0,  'l'),
  ('pasta',       0.5,  'kg'),
  ('bananas',     1.0,  'kg'),
  ('coffee',      0.25, 'kg')
) AS v(key, qty, uom)
WHERE i."key" = v.key;--> statement-breakpoint
-- Trigram search over 28k product names, for the product search endpoint.
--
-- The deployed role is superuser so this succeeds; the trap is for a hardened
-- role later. Migrations run at boot in DatabaseModule.onModuleInit, so an
-- uncaught error here would take the API down rather than degrade a feature --
-- and this one is only an optimisation. Without the extension the search still
-- works, ILIKE just sequentially scans 28k rows in ~80ms instead of using an
-- index.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm not installed: product search falls back to a sequential scan';
END $$;--> statement-breakpoint
-- gin_trgm_ops is what makes ILIKE '%term%' indexable at all; a btree cannot
-- serve a leading wildcard. Not CONCURRENTLY: this runs inside the migration
-- transaction, and 28k rows is milliseconds.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "idx_products_name_trgm"
      ON "products" USING gin ("name" gin_trgm_ops);
  END IF;
END $$;
