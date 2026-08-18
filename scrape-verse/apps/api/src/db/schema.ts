import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** collector_id from Scraper Studio is the primary key: one row per fleet member. */
export const scrapers = pgTable("scrapers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  targetSite: text("target_site").notNull(),
  outputSchema: jsonb("output_schema").notNull(),
  status: text("status").notNull().default("healthy"),
  healBudgetDaily: integer("heal_budget_daily").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  scraperId: text("scraper_id").notNull().references(() => scrapers.id),
  trigger: text("trigger").notNull(), // cron | manual | canary
  status: text("status").notNull(), // ok | anomalous | error
  rawOutput: jsonb("raw_output"),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
});

export const baselines = pgTable("baselines", {
  scraperId: text("scraper_id").primaryKey().references(() => scrapers.id),
  fieldNullRates: jsonb("field_null_rates").notNull(),
  expectedRowCount: integer("expected_row_count").notNull(),
  valueRanges: jsonb("value_ranges").notNull(), // per-field p5/p95
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
});

export const priceRecords = pgTable("price_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  store: text("store").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  inStock: boolean("in_stock").notNull().default(true),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
});

export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  scraperId: text("scraper_id").notNull().references(() => scrapers.id),
  kind: text("kind").notNull(), // schema | nulls | rowcount | drift | freshness | error
  evidence: jsonb("evidence").notNull(),
  state: text("state").notNull().default("open"), // open | healing | resolved | manual
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const healAttempts = pgTable("heal_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id").notNull().references(() => incidents.id),
  claudeDiagnosis: text("claude_diagnosis").notNull(),
  healPrompt: text("heal_prompt").notNull(),
  studioDiff: text("studio_diff"),
  verdict: text("verdict"), // approved | rejected | failed
  creditsSpent: numeric("credits_spent", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // price_drop | breakage | healed | escalation
  channel: text("channel").notNull(), // email | telegram | discord
  payload: jsonb("payload").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
