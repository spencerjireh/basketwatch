"use client";

import { useMemo, useState } from "react";
import type { CreditBudget, FeedEvent, FleetScraper, Incident } from "@basketwatch/contract";
import { useCountry } from "@/components/country/country";
import { EventFeed } from "@/components/feed/event-feed";
import { FleetBoard } from "@/components/fleet/fleet-board";
import { HealDialog } from "@/components/fleet/heal-dialog";
import { AttemptHistory } from "@/components/healing/attempt-history";
import { AuditDialog } from "@/components/incident/audit-dialog";
import { Section } from "@/components/ui/section";
import { formatMoney } from "@/lib/format";

/**
 * Client-side because the audit dialog is shared state: the fleet board, the
 * activity feed, the incident list and the attempt history all open the same
 * one. That is also why these four live together rather than being split
 * across pages -- they are four indexes into a single story.
 */
export function HealingBoard({
  fleet: wholeFleet,
  feed,
  incidents,
  budget,
}: {
  fleet: FleetScraper[];
  feed: FeedEvent[];
  incidents: Incident[];
  budget: CreditBudget;
}) {
  const { country, scope } = useCountry();
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const openIncident = useMemo(
    () => incidents.find((incident) => incident.id === openIncidentId) ?? null,
    [incidents, openIncidentId],
  );
  const [healTarget, setHealTarget] = useState<FleetScraper | null>(null);

  // The only page where "all" is offered, because the fleet is the only thing
  // here that spans countries. The feed, the incidents and the budget were
  // always fleet-wide: an incident carries no country of its own.
  const fleet = scope === "all" ? wholeFleet : wholeFleet.filter((s) => s.country === country);

  const healthy = fleet.filter((s) => s.status === "healthy").length;
  const attention = fleet.length - healthy;

  return (
    <>
      <p className="font-mono text-[12px]">
        <span className="text-live">{healthy} healthy</span>
        {attention > 0 ? (
          <>
            {" · "}
            <span className="text-drift">{attention} need attention</span>
          </>
        ) : null}
        {" · "}
        <span className="text-mute">
          {formatMoney(budget.spentToday.amount, budget.spentToday.currency)} of{" "}
          {formatMoney(budget.dailyCeiling.amount, budget.dailyCeiling.currency)} spent today
        </span>
      </p>

      <div className="mt-8 grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section
          title="Live"
          caption="One row per store, coloured by state. A store is not a scraper: most are pulled over plain HTTP and have no collector."
        >
          <FleetBoard fleet={fleet} onOpenIncident={setOpenIncidentId} onHeal={setHealTarget} />
        </Section>

        <Section title="Activity" caption="Runs, incidents and alerts, newest first.">
          <EventFeed events={feed} onOpenIncident={setOpenIncidentId} />
        </Section>

        <Section
          title="Incidents"
          caption="What broke, and what the evidence was."
          className="lg:col-span-2"
        >
          {incidents.length === 0 ? (
            <p className="text-[13px] text-mute">No incidents recorded.</p>
          ) : (
            <ul className="mt-1 flex flex-col">
              {incidents.map((incident) => (
                <li
                  key={incident.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line py-2.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    <span className="text-broken">{incident.kind.replace(/_/g, " ")}</span>
                    {" · "}
                    {incident.summary}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenIncidentId(incident.id)}
                    className="font-mono text-[11px] text-mute underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
                  >
                    open audit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Every repair"
          caption="One line per attempt: what was sent, what came back, what it cost."
          className="lg:col-span-2"
        >
          <AttemptHistory incidents={incidents} onOpenIncident={setOpenIncidentId} />
        </Section>
      </div>

      <AuditDialog incident={openIncident} onClose={() => setOpenIncidentId(null)} />
      {healTarget?.collectorId ? (
        <HealDialog
          scraperId={healTarget.collectorId}
          storeName={healTarget.name}
          open={!!healTarget}
          onClose={() => setHealTarget(null)}
        />
      ) : null}
    </>
  );
}
