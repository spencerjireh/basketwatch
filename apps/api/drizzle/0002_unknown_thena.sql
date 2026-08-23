ALTER TABLE "items" ADD COLUMN "index_quantity" double precision;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "index_uom" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_index_uom_matches_normal_unit" CHECK (("items"."index_quantity" is null and "items"."index_uom" is null)
          or ("items"."index_quantity" > 0 and "items"."index_uom" = case "items"."normal_unit"
                when 'g' then 'kg' when 'ml' then 'l' else 'count' end));--> statement-breakpoint
-- The ten staples the basket is made of, and how much of each one basket buys.
--
-- Reference data, in the migration, for the same reason the items rows are: the
-- deploy pulls main and runs compose, and there is no step where
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
--> statement-breakpoint
-- Two US pins that are not the item they stand for.
--
-- Neither is caught by any automatic flag: both parse cleanly and both are
-- cheap, so they win the unit-price ranking rather than tripping the outlier
-- rule. Ranking by unit price is what made them visible, and printing the
-- product name on every receipt line is what keeps that class of error visible.
--
-- Marked not_stocked rather than repointed, because neither store carries the
-- real item at all: MexGrocer's entire chicken catalogue is pozole, bouillon
-- and soup, and Latimex sells cornmeal, breadcrumbs and cassava bread but no
-- loaf. There is nothing to repoint to.
--
-- This edits basket_map, which the data quality gate also writes. That is
-- deliberate and the precedence is right: this runs once at deploy, and a later
-- re-verification by the gate wins over it. The alternative was a script run by
-- hand, and the failure mode there is someone forgetting -- which leaves canned
-- soup standing in for chicken on the public page.
UPDATE "basket_map"
SET "status" = 'not_stocked',
    "why" = 'canned soup, not chicken meat; MexGrocer carries no chicken to repoint to'
WHERE "item_key" = 'chicken' AND "store_id" = 'us-mexgrocer' AND "status" = 'verified';--> statement-breakpoint
UPDATE "basket_map"
SET "status" = 'not_stocked',
    "why" = 'a baking mix, not a loaf; Latimex carries no bread to repoint to'
WHERE "item_key" = 'bread' AND "store_id" = 'us-latimex' AND "status" = 'verified';
