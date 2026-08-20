CREATE TABLE IF NOT EXISTS "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "baselines" (
	"scraper_id" text PRIMARY KEY NOT NULL,
	"field_null_rates" jsonb NOT NULL,
	"expected_row_count" integer NOT NULL,
	"value_ranges" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "basket_map" (
	"item_key" text NOT NULL,
	"store_id" text NOT NULL,
	"product_key" text,
	"url" text,
	"status" text NOT NULL,
	"via" text,
	"note" text,
	"why" text,
	"pricing_note" text,
	"category" text,
	"category_tier" integer,
	"candidates" integer,
	"target_size" text,
	"picked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "basket_map_item_key_store_id_pk" PRIMARY KEY("item_key","store_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "heal_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"claude_diagnosis" text NOT NULL,
	"heal_prompt" text NOT NULL,
	"studio_diff" text,
	"verdict" text,
	"credits_spent" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text,
	"scraper_id" text,
	"run_id" bigint,
	"kind" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "items" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"tier" text NOT NULL,
	"group" text NOT NULL,
	"group_weight_note" text,
	"numbeo_equivalent" text,
	"normal_unit" text NOT NULL,
	"target_size" jsonb NOT NULL,
	"match" jsonb NOT NULL,
	"categories" jsonb NOT NULL,
	"min_base_quantity" double precision,
	"min_base_quantity_note" text,
	"spec_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint,
	"store_id" text NOT NULL,
	"product_key" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"price" numeric(12, 4) NOT NULL,
	"currency" text NOT NULL,
	"unit_price" numeric(16, 6),
	"unit_price_basis" text,
	"in_stock" boolean,
	"source" text DEFAULT 'puller' NOT NULL,
	"change" text NOT NULL,
	"previous_price" numeric(12, 4),
	"delta" numeric(12, 4)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"store_id" text NOT NULL,
	"product_key" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"category" text,
	"unit" text,
	"size_value" double precision,
	"size_uom" text,
	"size_quantity" double precision,
	"size_base_uom" text,
	"size_form" text,
	"size_approximate" boolean DEFAULT false NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	CONSTRAINT "products_store_id_product_key_pk" PRIMARY KEY("store_id","product_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" text,
	"scraper_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text,
	"transport" text,
	"source" text,
	"trigger" text,
	"status" text,
	"rows" integer DEFAULT 0 NOT NULL,
	"unit_priced" integer DEFAULT 0 NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"ceiling_reached" boolean DEFAULT false NOT NULL,
	"changes" integer DEFAULT 0 NOT NULL,
	"coverage" text,
	"credits_usd" numeric(10, 4),
	"raw_output" jsonb,
	CONSTRAINT "runs_attached_to_something" CHECK ("runs"."store_id" is not null or "runs"."scraper_id" is not null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scrapers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target_site" text NOT NULL,
	"output_schema" jsonb NOT NULL,
	"status" text DEFAULT 'healthy' NOT NULL,
	"heal_budget_daily" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stores" (
	"store_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"currency" text,
	"method" text,
	"endpoint" text,
	"max_pages" integer,
	"coverage" text,
	"coverage_reason" text,
	"index_contributor" boolean DEFAULT false NOT NULL,
	"studio_collector_id" text,
	"needs_browser" boolean DEFAULT false NOT NULL,
	"needs_unlocker" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "baselines" ADD CONSTRAINT "baselines_scraper_id_scrapers_id_fk" FOREIGN KEY ("scraper_id") REFERENCES "public"."scrapers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "basket_map" ADD CONSTRAINT "basket_map_item_key_items_key_fk" FOREIGN KEY ("item_key") REFERENCES "public"."items"("key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "basket_map" ADD CONSTRAINT "basket_map_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "basket_map" ADD CONSTRAINT "basket_map_store_id_product_key_products_store_id_product_key_fk" FOREIGN KEY ("store_id","product_key") REFERENCES "public"."products"("store_id","product_key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heal_attempts" ADD CONSTRAINT "heal_attempts_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_scraper_id_scrapers_id_fk" FOREIGN KEY ("scraper_id") REFERENCES "public"."scrapers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_store_id_product_key_products_store_id_product_key_fk" FOREIGN KEY ("store_id","product_key") REFERENCES "public"."products"("store_id","product_key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_scraper_id_scrapers_id_fk" FOREIGN KEY ("scraper_id") REFERENCES "public"."scrapers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stores" ADD CONSTRAINT "stores_studio_collector_id_scrapers_id_fk" FOREIGN KEY ("studio_collector_id") REFERENCES "public"."scrapers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_basket_map_product" ON "basket_map" USING btree ("store_id","product_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_obs_product" ON "price_observations" USING btree ("store_id","product_key","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_obs_at" ON "price_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_store" ON "runs" USING btree ("store_id","at");--> statement-breakpoint
-- Latest known price per product. Ordered by id rather than observed_at because
-- two observations can share a timestamp (the pull writes whole seconds) and a
-- tie would return both rows. Not generated by drizzle-kit 0.28, which does not
-- emit views; it is declared in schema.ts with .existing() for typed reads.
CREATE VIEW "latest_price" AS
SELECT DISTINCT ON ("store_id", "product_key") *
FROM "price_observations"
ORDER BY "store_id", "product_key", "id" DESC;