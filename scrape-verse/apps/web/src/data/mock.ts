import type { ScraperState } from "../types";

/**
 * MOCK DATA — shaped exactly like the orchestrator API responses so the
 * real endpoints can replace this module without touching components.
 * Replace with fetch calls to /api/* as the backend lands (day 2-4).
 */

export interface FleetScraper {
  id: string;
  name: string;
  store: string;
  status: ScraperState;
  lastRunAt: string;
  lastRunRows: number;
  nullRatePct: number;
  healsToday: number;
}

export interface BasketPoint {
  date: string;
  /** basket total in USD; null = data gap while a scraper was broken */
  total: number | null;
  healed?: boolean;
}

export interface FeedEvent {
  id: string;
  at: string;
  scraper: string;
  kind: "breakage" | "healing" | "healed" | "price_drop" | "escalation";
  summary: string;
}

export const fleet: FleetScraper[] = [
  { id: "c_parker01", name: "parkers-pantry", store: "Parker's Pantry (test target)", status: "healthy", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 10, nullRatePct: 0, healsToday: 1 },
  { id: "c_grocer01", name: "hillside-market", store: "Hillside Market", status: "healthy", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 10, nullRatePct: 2, healsToday: 0 },
  { id: "c_pharma01", name: "corner-pharmacy", store: "Corner Pharmacy", status: "suspect", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 7, nullRatePct: 18, healsToday: 0 },
  { id: "c_grocer02", name: "bay-fresh", store: "Bay Fresh Foods", status: "healing", lastRunAt: "2026-08-17T09:00:00Z", lastRunRows: 10, nullRatePct: 84, healsToday: 1 },
  { id: "c_elect01", name: "voltmart", store: "VoltMart Electronics", status: "healthy", lastRunAt: "2026-08-17T21:00:00Z", lastRunRows: 10, nullRatePct: 0, healsToday: 0 },
];

export const basketSeries: BasketPoint[] = [
  { date: "Aug 10", total: 42.61 },
  { date: "Aug 11", total: 42.55 },
  { date: "Aug 12", total: 42.9 },
  { date: "Aug 13", total: null }, // bay-fresh selector drift: silent gap
  { date: "Aug 14", total: null },
  { date: "Aug 15", total: 43.12, healed: true },
  { date: "Aug 16", total: 43.05 },
  { date: "Aug 17", total: 42.87 },
];

export const feed: FeedEvent[] = [
  { id: "e6", at: "2026-08-17T21:04:00Z", scraper: "bay-fresh", kind: "healing", summary: "Heal attempt 1/3 running: price null-rate 84% vs 2% baseline. Prompt targets renamed cost selectors." },
  { id: "e5", at: "2026-08-17T21:02:00Z", scraper: "bay-fresh", kind: "breakage", summary: "Spider-sense: hard nulls anomaly. 8/10 rows missing price and name after site layout change." },
  { id: "e4", at: "2026-08-17T21:00:00Z", scraper: "corner-pharmacy", kind: "price_drop", summary: "Ground Coffee (12 oz) dropped 11% to $8.49 — alert sent (email, telegram)." },
  { id: "e3", at: "2026-08-15T10:31:00Z", scraper: "bay-fresh", kind: "healed", summary: "Heal verified by canary run: 0% empty rows (was 85%). Diff approved and saved to production." },
  { id: "e2", at: "2026-08-15T10:16:00Z", scraper: "bay-fresh", kind: "healing", summary: "Evidence bundle sent to Claude; heal prompt issued to Scraper Studio (refactor_template)." },
  { id: "e1", at: "2026-08-15T10:15:00Z", scraper: "bay-fresh", kind: "breakage", summary: "Freshness + nulls anomaly opened incident. Basket chart gap begins." },
];

export const basketItems = [
  { name: "Eggs (dozen)", cheapest: "Hillside Market", price: 4.29, delta: -0.7 },
  { name: "Whole Milk (1 gal)", cheapest: "Bay Fresh Foods", price: 3.79, delta: 0.0 },
  { name: "White Bread", cheapest: "Parker's Pantry", price: 2.79, delta: 1.1 },
  { name: "Rice (5 lb)", cheapest: "Hillside Market", price: 6.49, delta: -2.3 },
  { name: "Ground Coffee (12 oz)", cheapest: "Corner Pharmacy", price: 8.49, delta: -11.0 },
  { name: "Sugar (4 lb)", cheapest: "Bay Fresh Foods", price: 3.39, delta: 0.6 },
  { name: "Chicken Breast (lb)", cheapest: "Hillside Market", price: 3.99, delta: -1.5 },
  { name: "Vegetable Oil (48 oz)", cheapest: "VoltMart Electronics", price: 5.09, delta: 0.0 },
  { name: "Spaghetti (1 lb)", cheapest: "Parker's Pantry", price: 1.89, delta: 0.0 },
  { name: "Bananas (lb)", cheapest: "Bay Fresh Foods", price: 0.65, delta: -5.8 },
];
