import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The data plane is the catalogue shape proven in spencer-exploration: identity
 * is (store_id, product_key), sizes are stored decomposed so unit price can be
 * computed and compared, and history is change-only. The control plane
 * (scrapers, baselines, heal_attempts, alerts) is the self-healing machinery.
 *
 * Money is numeric, never float. Sizes are doublePrecision - they are
 * measurements, and drizzle hands numeric back as a string.
 */

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

/**
 * A retailer we track. Distinct from a scraper: 15 of 19 stores are pulled
 * directly over HTTP and have no Studio collector at all.
 */
export const stores = pgTable("stores", {
  storeId: text("store_id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  currency: text("currency"),
  method: text("method"),
  endpoint: text("endpoint"),
  maxPages: integer("max_pages"),
  coverage: text("coverage"),
  coverageReason: text("coverage_reason"),
  indexContributor: boolean("index_contributor").notNull().default(false),
  studioCollectorId: text("studio_collector_id").references(() => scrapers.id),
  needsBrowser: boolean("needs_browser").notNull().default(false),
  needsUnlocker: boolean("needs_unlocker").notNull().default(false),
});

/**
 * Identity is (store_id, product_key). The same physical product in two stores
 * is two rows on purpose: matching them across retailers is basket_map's job,
 * not something the collector should silently assume.
 */
export const products = pgTable(
  "products",
  {
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId),
    productKey: text("product_key").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    category: text("category"),
    /** the size exactly as the store displayed it */
    unit: text("unit"),
    sizeValue: doublePrecision("size_value"),
    sizeUom: text("size_uom"),
    /** normalised into the base unit: 5000, 250, 24 */
    sizeQuantity: doublePrecision("size_quantity"),
    /** g | ml | count */
    sizeBaseUom: text("size_base_uom"),
    /** plain | multipack | fraction | range | volume | count */
    sizeForm: text("size_form"),
    sizeApproximate: boolean("size_approximate").notNull().default(false),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.storeId, t.productKey] }),
  }),
);

/**
 * One row per execution, whether that was a catalogue pull over HTTP or a
 * Studio collector run. They are the same event in the product story, so the
 * feed, the credit ledger and the validator all read one history.
 *
 * store_id is nullable rather than required because a trial run can target a
 * collector that has no store row yet; the check keeps a run attached to at
 * least one of the two.
 */
export const runs = pgTable(
  "runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    storeId: text("store_id").references(() => stores.storeId),
    scraperId: text("scraper_id").references(() => scrapers.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    method: text("method"),
    /** studio | http */
    transport: text("transport"),
    /** studio | puller: what actually produced the rows */
    source: text("source"),
    /** cron | manual | canary */
    trigger: text("trigger"),
    /** ok | anomalous | error */
    status: text("status"),
    rows: integer("rows").notNull().default(0),
    unitPriced: integer("unit_priced").notNull().default(0),
    pages: integer("pages").notNull().default(0),
    ceilingReached: boolean("ceiling_reached").notNull().default(false),
    changes: integer("changes").notNull().default(0),
    coverage: text("coverage"),
    creditsUsd: numeric("credits_usd", { precision: 10, scale: 4 }),
    rawOutput: jsonb("raw_output"),
    /** spider-sense verdict + findings from the validate-run handler */
    findings: jsonb("findings"),
    /** computed from the run's products; drives the fleet board's null column */
    nullRatePct: numeric("null_rate_pct", { precision: 5, scale: 2 }),
  },
  (t) => ({
    storeAt: index("idx_runs_store").on(t.storeId, t.at),
    attached: check(
      "runs_attached_to_something",
      sql`${t.storeId} is not null or ${t.scraperId} is not null`,
    ),
  }),
);

/**
 * Change-only history: a row lands when a price first appears or when it moves,
 * never on every run. Grocery prices barely move day to day, so full snapshots
 * would be ~99% duplicate; runs.rows is what makes a truncated pull
 * distinguishable from a genuine mass price move.
 */
export const priceObservations = pgTable(
  "price_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: bigint("run_id", { mode: "number" }).references(() => runs.id),
    storeId: text("store_id").notNull(),
    productKey: text("product_key").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    price: numeric("price", { precision: 12, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    /** per kg / per litre / per item, see unit_price_basis */
    unitPrice: numeric("unit_price", { precision: 16, scale: 6 }),
    unitPriceBasis: text("unit_price_basis"),
    inStock: boolean("in_stock"),
    /** studio | puller | manual */
    source: text("source").notNull().default("puller"),
    /** new | price */
    change: text("change").notNull(),
    previousPrice: numeric("previous_price", { precision: 12, scale: 4 }),
    delta: numeric("delta", { precision: 12, scale: 4 }),
  },
  (t) => ({
    product: foreignKey({
      columns: [t.storeId, t.productKey],
      foreignColumns: [products.storeId, products.productKey],
    }),
    byProduct: index("idx_obs_product").on(t.storeId, t.productKey, t.id),
    byAt: index("idx_obs_at").on(t.observedAt),
  }),
);

/**
 * Latest known price per product. Ordered by id rather than observed_at because
 * two observations can share a timestamp - the pull writes whole seconds - and
 * a tie would return both rows.
 */
export const latestPrice = pgView("latest_price", {
  id: bigint("id", { mode: "number" }),
  runId: bigint("run_id", { mode: "number" }),
  storeId: text("store_id"),
  productKey: text("product_key"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  price: numeric("price", { precision: 12, scale: 4 }),
  currency: text("currency"),
  unitPrice: numeric("unit_price", { precision: 16, scale: 6 }),
  unitPriceBasis: text("unit_price_basis"),
  inStock: boolean("in_stock"),
  source: text("source"),
  change: text("change"),
  previousPrice: numeric("previous_price", { precision: 12, scale: 4 }),
  delta: numeric("delta", { precision: 12, scale: 4 }),
}).existing();

/**
 * The tracked item registry: one canonical item, matched to one concrete
 * product per store. Match rules are data, never code, so adding an item or a
 * country is a row edit.
 */
export const items = pgTable(
  "items",
  {
    key: text("key").primaryKey(),
    label: text("label").notNull(),
    /** core | stretch | registered */
    tier: text("tier").notNull(),
    group: text("group").notNull(),
    groupWeightNote: text("group_weight_note"),
    numbeoEquivalent: text("numbeo_equivalent"),
    /** g | ml | count */
    normalUnit: text("normal_unit").notNull(),
    /** per-country target pack size: { "US": "5 lb", "PH": "5 kg" } */
    targetSize: jsonb("target_size").notNull(),
    /** { must, must_by_country, exclude } */
    match: jsonb("match").notNull(),
    categories: jsonb("categories").notNull(),
    minBaseQuantity: doublePrecision("min_base_quantity"),
    minBaseQuantityNote: text("min_base_quantity_note"),
    /**
     * How much of this item one basket buys: 5 kg of rice, 12 eggs.
     *
     * target_size cannot serve this. It is prose written for a human picking a
     * pin -- "ground or instant refill", "tray (30) or dozen", "per lb" -- and
     * three of the ten core items have a PH target that parses to nothing. The
     * index multiplies a unit price by a number, so the number has to be a
     * number.
     *
     * Nullable because stretch and registered items are not in the basket and
     * never will be; a default would be a claim about items nobody has priced.
     */
    indexQuantity: doublePrecision("index_quantity"),
    /** kg | l | count -- the readable pair for normal_unit's g | ml | count */
    indexUom: text("index_uom"),
    specVersion: integer("spec_version").notNull().default(1),
  },
  (t) => ({
    /*
     * index_uom is derivable from normal_unit and exists only so the quantity
     * is self-describing on the wire. The check is what stops the two drifting
     * apart, which would have the dashboard print "5 l of rice".
     */
    indexUnit: check(
      "items_index_uom_matches_normal_unit",
      sql`(${t.indexQuantity} is null and ${t.indexUom} is null)
          or (${t.indexQuantity} > 0 and ${t.indexUom} = case ${t.normalUnit}
                when 'g' then 'kg' when 'ml' then 'l' else 'count' end)`,
    ),
  }),
);

/**
 * The pin: which concrete product stands in for a canonical item at a store.
 * product_key is null when the pick was curated by hand from a page that is
 * not in the store's catalogue, which is why price lives on the observation
 * and never here.
 */
export const basketMap = pgTable(
  "basket_map",
  {
    itemKey: text("item_key")
      .notNull()
      .references(() => items.key),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.storeId),
    productKey: text("product_key"),
    url: text("url"),
    /** verified | not_found | not_stocked | curated */
    status: text("status").notNull(),
    /** catalogue | manual */
    via: text("via"),
    note: text("note"),
    why: text("why"),
    pricingNote: text("pricing_note"),
    category: text("category"),
    categoryTier: integer("category_tier"),
    candidates: integer("candidates"),
    targetSize: text("target_size"),
    pickedAt: timestamp("picked_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.itemKey, t.storeId] }),
    product: foreignKey({
      columns: [t.storeId, t.productKey],
      foreignColumns: [products.storeId, products.productKey],
    }),
    byProduct: index("idx_basket_map_product").on(t.storeId, t.productKey),
  }),
);

export const baselines = pgTable("baselines", {
  storeId: text("store_id")
    .primaryKey()
    .references(() => stores.storeId),
  fieldNullRates: jsonb("field_null_rates").notNull(),
  expectedRowCount: integer("expected_row_count").notNull(),
  valueRanges: jsonb("value_ranges").notNull(), // per-field p5/p95
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: text("store_id").references(() => stores.storeId),
  scraperId: text("scraper_id").references(() => scrapers.id),
  runId: bigint("run_id", { mode: "number" }).references(() => runs.id),
  // schema | nulls | rowcount | drift | freshness | error | studio_failed |
  // mass_change_suppressed
  kind: text("kind").notNull(),
  evidence: jsonb("evidence").notNull(),
  state: text("state").notNull().default("open"), // open | healing | resolved | manual
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const healAttempts = pgTable("heal_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id),
  /** 1-based, capped by HEAL_MAX_ATTEMPTS_PER_INCIDENT */
  attempt: integer("attempt").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  /** null while the attempt is still in flight */
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  claudeDiagnosis: text("claude_diagnosis").notNull(),
  healPrompt: text("heal_prompt").notNull(),
  studioDiff: text("studio_diff"),
  /** { ranAt, rows, nullRatePct, status } from the verification run */
  canary: jsonb("canary"),
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
