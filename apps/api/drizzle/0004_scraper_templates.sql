CREATE TABLE scraper_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper_id TEXT NOT NULL REFERENCES scrapers(id),
  template_json JSONB NOT NULL,
  source TEXT NOT NULL,
  heal_attempt_id UUID REFERENCES heal_attempts(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scraper_templates_scraper ON scraper_templates(scraper_id, captured_at DESC);
