import type {
  BasketItem,
  BasketSeries,
  CreditBudget,
  FeedEvent,
  FleetScraper,
  HealAttempt,
  Incident,
} from "@scrape-verse/shared";

/**
 * MOCK DATA — the response shapes come from @scrape-verse/shared, which is the
 * frozen API contract (see docs/api-contract.md). These fixtures are what the
 * real /api/* endpoints must return, so components can swap to fetch calls
 * without changing a single type.
 */

export const fleet: FleetScraper[] = [
  { id: "c_parker01", name: "parkers-pantry", store: "Parker's Pantry (test target)", country: "US", status: "healthy", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 10, nullRatePct: 0, healsToday: 1, openIncidentId: null },
  { id: "c_grocer01", name: "hillside-market", store: "Hillside Market", country: "US", status: "healthy", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 10, nullRatePct: 2, healsToday: 0, openIncidentId: null },
  { id: "c_pharma01", name: "corner-pharmacy", store: "Corner Pharmacy", country: "US", status: "suspect", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 7, nullRatePct: 18, healsToday: 0, openIncidentId: null },
  { id: "c_grocer02", name: "bay-fresh", store: "Bay Fresh Foods", country: "US", status: "healing", lastRunAt: "2026-08-17T09:00:00Z", lastRunRows: 10, nullRatePct: 84, healsToday: 1, openIncidentId: "inc_002" },
  { id: "c_elect01", name: "voltmart", store: "VoltMart Electronics", country: "US", status: "healthy", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 10, nullRatePct: 0, healsToday: 0, openIncidentId: null },
];

/** One series per country; PH joins here if the vetting gate passes. */
export const basketIndex: BasketSeries[] = [
  {
    country: "US",
    currency: "USD",
    points: [
      { date: "Aug 10", total: 42.61 },
      { date: "Aug 11", total: 42.55 },
      { date: "Aug 12", total: 42.9 },
      { date: "Aug 13", total: null }, // bay-fresh selector drift: silent gap
      { date: "Aug 14", total: null },
      { date: "Aug 15", total: 43.12, healed: true },
      { date: "Aug 16", total: 43.05 },
      { date: "Aug 17", total: 42.87 },
    ],
  },
];

export const feed: FeedEvent[] = [
  { id: "e6", at: "2026-08-17T21:04:00Z", scraper: "bay-fresh", kind: "healing", summary: "Heal attempt 1/3 running: price null-rate 84% vs 2% baseline. Prompt targets renamed cost selectors.", incidentId: "inc_002" },
  { id: "e5", at: "2026-08-17T21:02:00Z", scraper: "bay-fresh", kind: "breakage", summary: "Spider-sense: hard nulls anomaly. 8/10 rows missing price and name after site layout change.", incidentId: "inc_002" },
  { id: "e4", at: "2026-08-17T21:00:00Z", scraper: "corner-pharmacy", kind: "price_drop", summary: "Ground Coffee (12 oz) dropped 11% to $8.49 — alert sent (email, telegram).", incidentId: null },
  { id: "e3", at: "2026-08-15T10:31:00Z", scraper: "bay-fresh", kind: "healed", summary: "Heal verified by canary run: 0% empty rows (was 85%). Diff approved and saved to production.", incidentId: "inc_001" },
  { id: "e2", at: "2026-08-15T10:16:00Z", scraper: "bay-fresh", kind: "healing", summary: "Evidence bundle sent to Claude; heal prompt issued to Scraper Studio (refactor_template).", incidentId: "inc_001" },
  { id: "e1", at: "2026-08-15T10:15:00Z", scraper: "bay-fresh", kind: "breakage", summary: "Freshness + nulls anomaly opened incident. Basket chart gap begins.", incidentId: "inc_001" },
];

export const basketItems: BasketItem[] = [
  { productKey: "eggs_dozen", name: "Eggs (dozen)", unit: "dozen", country: "US", cheapestStore: "Hillside Market", price: 4.29, currency: "USD", deltaPct: -0.7 },
  { productKey: "milk_whole_gal", name: "Whole Milk (1 gal)", unit: "gal", country: "US", cheapestStore: "Bay Fresh Foods", price: 3.79, currency: "USD", deltaPct: 0 },
  { productKey: "bread_white", name: "White Bread", unit: "loaf", country: "US", cheapestStore: "Parker's Pantry", price: 2.79, currency: "USD", deltaPct: 1.1 },
  { productKey: "rice_5lb", name: "Rice (5 lb)", unit: "5 lb", country: "US", cheapestStore: "Hillside Market", price: 6.49, currency: "USD", deltaPct: -2.3 },
  { productKey: "coffee_ground_12oz", name: "Ground Coffee (12 oz)", unit: "12 oz", country: "US", cheapestStore: "Corner Pharmacy", price: 8.49, currency: "USD", deltaPct: -11 },
  { productKey: "sugar_4lb", name: "Sugar (4 lb)", unit: "4 lb", country: "US", cheapestStore: "Bay Fresh Foods", price: 3.39, currency: "USD", deltaPct: 0.6 },
  { productKey: "chicken_breast_lb", name: "Chicken Breast (lb)", unit: "lb", country: "US", cheapestStore: "Hillside Market", price: 3.99, currency: "USD", deltaPct: -1.5 },
  { productKey: "oil_48oz", name: "Vegetable Oil (48 oz)", unit: "48 oz", country: "US", cheapestStore: "VoltMart Electronics", price: 5.09, currency: "USD", deltaPct: 0 },
  { productKey: "pasta_1lb", name: "Spaghetti (1 lb)", unit: "1 lb", country: "US", cheapestStore: "Parker's Pantry", price: 1.89, currency: "USD", deltaPct: 0 },
  { productKey: "bananas_lb", name: "Bananas (lb)", unit: "lb", country: "US", cheapestStore: "Bay Fresh Foods", price: 0.65, currency: "USD", deltaPct: -5.8 },
];

const resolvedAttempt: HealAttempt = {
  id: "heal_001",
  incidentId: "inc_001",
  attempt: 1,
  startedAt: "2026-08-15T10:16:00Z",
  finishedAt: "2026-08-15T10:31:00Z",
  claudeDiagnosis:
    "Price and name are null on 85% of rows while row count is unchanged, so the page still lists products but the price selector no longer matches. The store moved the price into a nested span and renamed the cost class.",
  healPrompt:
    "The price field is empty for most products. Read the price from the nested span inside the product card's price container instead of the element's direct text, and strip the currency symbol before parsing.",
  studioDiff:
    "- const price = card.querySelector('.cost').textContent;\n+ const priceEl = card.querySelector('[class*=\"price\"] span, .cost span, .cost');\n+ const price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, ''));",
  canary: {
    ranAt: "2026-08-15T10:29:00Z",
    rows: 10,
    nullRatePct: 0,
    verdict: { status: "ok", findings: [] },
  },
  verdict: "approved",
  creditsSpentUsd: 0.12,
};

const inFlightAttempt: HealAttempt = {
  id: "heal_002",
  incidentId: "inc_002",
  attempt: 1,
  startedAt: "2026-08-17T21:04:00Z",
  finishedAt: null,
  claudeDiagnosis:
    "Null-rate on price jumped to 84% against a 2% baseline with row count intact. Same failure signature as the August 15 layout change: the container class was renamed again.",
  healPrompt:
    "Price is missing on 8 of 10 products. Locate the price using a class-independent selector anchored on the product card's data-sku attribute, then parse the first currency-formatted number found inside it.",
  studioDiff: null,
  canary: null,
  verdict: null,
  creditsSpentUsd: 0.04,
};

export const incidents: Incident[] = [
  {
    id: "inc_002",
    scraperId: "c_grocer02",
    scraperName: "bay-fresh",
    kind: "nulls",
    state: "healing",
    openedAt: "2026-08-17T21:02:00Z",
    resolvedAt: null,
    summary: "8/10 rows missing price and name after a layout change; heal attempt 1 of 3 in flight.",
    evidence: {
      kind: "nulls",
      failedChecks: [
        { check: "nulls", severity: "hard", detail: "price: null-rate 84% vs baseline 2%" },
        { check: "nulls", severity: "soft", detail: "name: null-rate 30% vs baseline 0%" },
      ],
      sampleBadRows: [
        { product_key: "eggs_dozen", name: null, price: null, currency: "USD", unit: "dozen", in_stock: true, url: "https://bayfresh.example/p/eggs-dozen", observed_at: "2026-08-17T21:00:00Z" },
      ],
      sampleGoodRows: [
        { product_key: "eggs_dozen", name: "Eggs (dozen)", price: 4.49, currency: "USD", unit: "dozen", in_stock: true, url: "https://bayfresh.example/p/eggs-dozen", observed_at: "2026-08-16T21:00:00Z" },
      ],
      fieldNullRates: { price: 0.84, name: 0.3, url: 0 },
      baselineNullRates: { price: 0.02, name: 0, url: 0 },
      rowCount: 10,
      expectedRowCount: 10,
    },
    attempts: [inFlightAttempt],
  },
  {
    id: "inc_001",
    scraperId: "c_grocer02",
    scraperName: "bay-fresh",
    kind: "nulls",
    state: "resolved",
    openedAt: "2026-08-15T10:15:00Z",
    resolvedAt: "2026-08-15T10:31:00Z",
    summary: "Silent price nulls closed the basket index for two days; healed autonomously on the first attempt.",
    evidence: {
      kind: "nulls",
      failedChecks: [
        { check: "nulls", severity: "hard", detail: "price: null-rate 85% vs baseline 2%" },
        { check: "freshness", severity: "hard", detail: "expected delivery missed by 2h 40m" },
      ],
      sampleBadRows: [
        { product_key: "milk_whole_gal", name: "Whole Milk (1 gal)", price: null, currency: "USD", unit: "gal", in_stock: true, url: "https://bayfresh.example/p/milk-gal", observed_at: "2026-08-13T09:00:00Z" },
      ],
      sampleGoodRows: [
        { product_key: "milk_whole_gal", name: "Whole Milk (1 gal)", price: 3.85, currency: "USD", unit: "gal", in_stock: true, url: "https://bayfresh.example/p/milk-gal", observed_at: "2026-08-12T21:00:00Z" },
      ],
      fieldNullRates: { price: 0.85, name: 0, url: 0 },
      baselineNullRates: { price: 0.02, name: 0, url: 0 },
      rowCount: 10,
      expectedRowCount: 10,
    },
    attempts: [resolvedAttempt],
  },
];

export const creditBudget: CreditBudget = {
  balanceUsd: 49.76,
  spentTodayUsd: 0.16,
  dailyCeilingUsd: 5,
  healsToday: 2,
  maxAttemptsPerIncident: 3,
  maxHealsPerScraperPerDay: 5,
};
