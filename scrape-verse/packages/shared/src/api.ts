import type {
  Country,
  HealVerdict,
  IncidentEvidence,
  IncidentKind,
  IncidentState,
  ScraperState,
  Verdict,
} from "./index.js";

/**
 * Dashboard-facing REST contract. These are the exact response shapes the
 * orchestrator serves and the dashboard renders; `apps/web/src/data/mock.ts`
 * is the same contract filled with fixtures. Endpoint-to-type mapping lives
 * in `docs/api-contract.md`.
 *
 * All timestamps are ISO 8601 strings in UTC. Money is a number plus an ISO
 * currency code — never a preformatted string, so the UI owns formatting.
 */

/** GET /api/fleet */
export interface FleetScraper {
  /** collector_id from Scraper Studio */
  id: string;
  name: string;
  store: string;
  country: Country;
  status: ScraperState;
  lastRunAt: string;
  lastRunRows: number;
  nullRatePct: number;
  healsToday: number;
  /** set while the scraper is not healthy, so the board can link to the audit */
  openIncidentId: string | null;
}

export interface BasketPoint {
  date: string;
  /** basket total in the series currency; null = data gap while a scraper was broken */
  total: number | null;
  healed?: boolean;
}

/**
 * GET /api/basket/index
 * One series per country. Currencies are not mixed on a single series, which
 * is what lets the comparison view render US and PH side by side honestly.
 */
export interface BasketSeries {
  country: Country;
  currency: string;
  points: BasketPoint[];
}

/** GET /api/basket/today */
export interface BasketItem {
  productKey: string;
  name: string;
  unit: string;
  country: Country;
  cheapestStore: string;
  price: number;
  currency: string;
  /** percent change vs the previous observation; 0 = unchanged */
  deltaPct: number;
}

export const feedEventKinds = [
  "breakage",
  "healing",
  "healed",
  "price_drop",
  "escalation",
] as const;

export type FeedEventKind = (typeof feedEventKinds)[number];

/** GET /api/feed — also the SSE payload on /api/stream */
export interface FeedEvent {
  id: string;
  at: string;
  scraper: string;
  kind: FeedEventKind;
  summary: string;
  /** present for breakage/healing/healed events, so the feed links to the audit */
  incidentId: string | null;
}

/** Canary verification run fired after Studio saves a healed scraper. */
export interface CanaryResult {
  ranAt: string;
  rows: number;
  nullRatePct: number;
  verdict: Verdict;
}

/**
 * One pass of the heal loop. The audit viewer reads these front to back:
 * diagnosis, prompt, Studio diff, canary, verdict, cost.
 */
export interface HealAttempt {
  id: string;
  incidentId: string;
  /** 1-based; capped by HEAL_MAX_ATTEMPTS_PER_INCIDENT */
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  claudeDiagnosis: string;
  healPrompt: string;
  /** null until Studio returns a proposal */
  studioDiff: string | null;
  canary: CanaryResult | null;
  /** null while the attempt is still in flight */
  verdict: HealVerdict | null;
  creditsSpentUsd: number;
}

/** GET /api/incidents, GET /api/incidents/:id */
export interface Incident {
  id: string;
  scraperId: string;
  scraperName: string;
  kind: IncidentKind;
  state: IncidentState;
  openedAt: string;
  resolvedAt: string | null;
  summary: string;
  evidence: IncidentEvidence;
  attempts: HealAttempt[];
}

/**
 * GET /api/budget — the credit spend meter. Mirrors the budget-guard env
 * knobs so the dashboard shows the same ceilings the guard enforces.
 */
export interface CreditBudget {
  balanceUsd: number;
  spentTodayUsd: number;
  dailyCeilingUsd: number;
  healsToday: number;
  maxAttemptsPerIncident: number;
  maxHealsPerScraperPerDay: number;
}
