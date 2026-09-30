-- Government price series: DOE pump prices and LPG, the DOE Oil Monitor's
-- weekly adjustments, DA Bantay Presyo wet-market prices, DTI suggested retail
-- prices. Written by the private collector; read by the API.
--
-- gov_documents: every bulletin or daily table ingested, so each is read once.
CREATE TABLE gov_documents (
  source text NOT NULL,
  url text NOT NULL,
  title text,
  period_start date,
  period_end date,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  rows integer NOT NULL DEFAULT 0,
  PRIMARY KEY (source, url)
);
--> statement-breakpoint
-- gov_series: one priced thing at one place, e.g. doe_pump / RON 95 / Petron /
-- NCR / Quezon City / L. Empty strings, not nulls, so the unique key holds.
CREATE TABLE gov_series (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  commodity text NOT NULL,
  variant text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT '',
  place text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT '',
  CONSTRAINT gov_series_identity UNIQUE (source, commodity, variant, brand, region, place, unit)
);
--> statement-breakpoint
-- gov_prices: one row per series per period. Not change-only: the period is
-- the fact. A single figure stores price_min = price_max.
CREATE TABLE gov_prices (
  series_id bigint NOT NULL REFERENCES gov_series(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  price_min numeric(12, 2) NOT NULL,
  price_max numeric(12, 2) NOT NULL,
  document_url text,
  PRIMARY KEY (series_id, period_start)
);
--> statement-breakpoint
CREATE INDEX idx_gov_prices_period ON gov_prices (period_start);
--> statement-breakpoint
CREATE INDEX idx_gov_series_source ON gov_series (source, region, commodity);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bw_api') THEN
    GRANT SELECT ON gov_documents, gov_series, gov_prices TO bw_api;
  END IF;
END $$;
