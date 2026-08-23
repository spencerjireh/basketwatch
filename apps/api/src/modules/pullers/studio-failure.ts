import { type CheckName, type IncidentKind } from "@basketwatch/contract";
import { type StudioFailureKind } from "./adapters/studio.adapter.js";

/**
 * What each kind of Studio failure means for the incident and for the wallet.
 *
 * A heal asks Bright Data to rewrite the extraction template, so it can only
 * repair a scraper whose template is wrong. Everything else -- a slow store, a
 * dead collector, a sitemap our own code could not fetch -- is a real failure
 * worth an incident, and a waste of credits to heal.
 *
 * Every kind opens an incident. Exactly one of them heals.
 */
export type FailurePolicy = {
  incidentKind: IncidentKind;
  /** Whether a template rewrite could plausibly fix this. */
  autoHeal: boolean;
  /** Which validator check the failure is recorded against. */
  check: CheckName;
  /** One sentence for the dashboard; `summarise` reads this verbatim. */
  reason: (message: string) => string;
};

export const STUDIO_FAILURE: Record<StudioFailureKind, FailurePolicy> = {
  broken: {
    incidentKind: "studio_broken",
    autoHeal: true,
    check: "schema",
    reason: () => "Scraper Studio returned rows, but none matched the output contract",
  },
  timeout: {
    incidentKind: "studio_timeout",
    autoHeal: false,
    check: "freshness",
    reason: () => "Scraper Studio did not finish inside the deadline",
  },
  empty: {
    incidentKind: "studio_empty",
    // A collector that runs cleanly and extracts nothing is selectors
    // pointing at nothing -- the most heal-able failure there is. The thin
    // stores rotted for days on exactly this, invisibly, under the old
    // pipeline; the heal loop's cap bounds what a retry can spend.
    autoHeal: true,
    check: "rowcount",
    reason: () => "Scraper Studio ran and returned nothing at all",
  },
  no_urls: {
    incidentKind: "sitemap_error",
    autoHeal: false,
    check: "rowcount",
    reason: () => "No URLs to submit: catalogue discovery came back empty",
  },
  unprovisioned: {
    incidentKind: "provisioning_error",
    autoHeal: false,
    check: "schema",
    reason: () => "No Studio collector exists for this store yet",
  },
};
