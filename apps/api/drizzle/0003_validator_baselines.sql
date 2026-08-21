-- Re-key baselines from scraper_id to store_id.
--
-- The table exists but holds zero rows: nothing in the codebase reads or writes
-- it. Most pullable stores have no scraper (no studio_collector_id), so keying
-- on scraper_id would silently skip 15 of 16 stores. Drop and recreate is safe
-- because there is no data to preserve.
DROP TABLE IF EXISTS "baselines";--> statement-breakpoint
CREATE TABLE "baselines" (
  "store_id" text PRIMARY KEY REFERENCES "stores"("store_id"),
  "field_null_rates" jsonb NOT NULL,
  "expected_row_count" integer NOT NULL,
  "value_ranges" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
-- Validation findings on each run, computed by the validate-run handler.
ALTER TABLE "runs" ADD COLUMN "findings" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "null_rate_pct" numeric(5, 2);
