-- The store's registry category (grocery, pharmacy, electronics, ...), set by
-- the collector's seed. Search and drops filter on it; product-level
-- categories stay unexposed because stores fill them with navigation labels.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS category text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stores_category ON stores (category);
--> statement-breakpoint
-- The drops candidates: price decreases in the last week.
CREATE INDEX IF NOT EXISTS idx_obs_price_drops ON price_observations (observed_at)
  WHERE change = 'price' AND delta < 0;
