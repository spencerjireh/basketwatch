-- Phase 2 of the collector, read side first.
--
-- runs.started_at: when the pull began. The validator judges only the rows a
-- run actually saw (products.last_seen >= started_at); runs.at is written at
-- the end of the pull and cannot answer that. Old rows stay null.
ALTER TABLE runs ADD COLUMN started_at timestamptz;
--> statement-breakpoint
-- basket_map.missed_runs: consecutive applied pulls of the store that did not
-- see this pin. At two, the pin's price stops counting (see pin_gaps).
ALTER TABLE basket_map ADD COLUMN missed_runs integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- pin_gaps: spans in which a pin was missing from its store's pulls. The index
-- does not carry a pin's last price into a day inside a gap; the day falls back
-- to the other stores or shows as a gap. to_at is null while the gap is open.
CREATE TABLE pin_gaps (
  store_id text NOT NULL REFERENCES stores(store_id),
  product_key text NOT NULL,
  from_at timestamptz NOT NULL,
  to_at timestamptz,
  PRIMARY KEY (store_id, product_key, from_at)
);
--> statement-breakpoint
-- stores.pull_config: adapter-specific settings a store row needs beyond its
-- endpoint (a category list, say). Read by the collector only.
ALTER TABLE stores ADD COLUMN pull_config jsonb;
--> statement-breakpoint
-- The readers are a separate role; tables created after the grant need their
-- own. Guarded so a database without the role (local, CI) still migrates.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bw_api') THEN
    GRANT SELECT ON pin_gaps TO bw_api;
  END IF;
END $$;
