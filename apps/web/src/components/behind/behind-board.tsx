"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  CreditBudget,
  FeedEvent,
  FleetScraper,
  Incident,
  Rail,
} from "@basketwatch/contract";
import { captureOneCode } from "@/app/behind/actions";
import { QualityWorklist } from "@/components/behind/quality-worklist";
import { EventFeed } from "@/components/feed/event-feed";
import { FleetBoard } from "@/components/fleet/fleet-board";
import { HealDialog } from "@/components/fleet/heal-dialog";
import { AuditDialog } from "@/components/incident/audit-dialog";
import { Section } from "@/components/ui/section";
import { formatMoney } from "@/lib/format";

/**
 * The machinery, for the two audiences that need it: whoever is on the fleet,
 * and whoever is deciding whether to believe the front page.
 *
 * Client-side because the audit dialog is shared state across the fleet board
 * and the activity feed -- both open the same audit. The data still arrives
 * from a server component above, so first paint is server-rendered.
 */
export function BehindBoard({
  fleet,
  feed,
  incidents,
  budget,
  rails,
  rowsLastPull,
}: {
  fleet: FleetScraper[];
  feed: FeedEvent[];
  incidents: Incident[];
  budget: CreditBudget;
  rails: Rail[];
  rowsLastPull: number;
}) {
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const openIncident = useMemo(
    () => incidents.find((incident) => incident.id === openIncidentId) ?? null,
    [incidents, openIncidentId],
  );
  const [healTarget, setHealTarget] = useState<FleetScraper | null>(null);
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const handleCaptureCode = useCallback(async (scraper: FleetScraper) => {
    if (!scraper.collectorId || capturingId) return;
    setCapturingId(scraper.collectorId);
    await captureOneCode(scraper.collectorId);
    setCapturingId(null);
    window.location.reload();
  }, [capturingId]);

  const healthy = fleet.filter((s) => s.status === "healthy").length;
  const attention = fleet.length - healthy;
  const contributing = fleet.length;

  return (
    <>
      {/* The state of the world in one sentence, colour on the words only. */}
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
          <FleetBoard
            fleet={fleet}
            onOpenIncident={setOpenIncidentId}
            onHeal={setHealTarget}
            onCaptureCode={handleCaptureCode}
            capturingId={capturingId}
          />
        </Section>

        <div className="flex flex-col gap-10">
          <Section title="Provenance" caption="Where the numbers on the front page come from.">
            <dl className="flex flex-col gap-3 text-[13px]">
              <Fact term={`${contributing} stores`}>
                Each publishes its own catalogue. Fifteen are read over plain HTTP and cost nothing
                to check; one needs a browser.
              </Fact>
              <Fact term={`${rowsLastPull.toLocaleString("en-US")} rows in the last pull`}>
                Every row carries a decomposed pack size where the title gave one, which is what
                makes a 5&nbsp;lb bag and a 5&nbsp;kg sack comparable at all.
              </Fact>
              <Fact term="Change-only history">
                A price is stored when it first appears or when it moves, never on every run. Each
                run also writes a summary row, which is what tells a truncated pull apart from a
                genuinely quiet day.
              </Fact>
              <Fact term="No carried-forward totals">
                A day that cannot price all ten staples scores no total. The chart draws the gap
                instead of interpolating across it.
              </Fact>
            </dl>
          </Section>

          <Section title="Activity" caption="Runs, incidents and alerts, newest first.">
            <EventFeed events={feed} onOpenIncident={setOpenIncidentId} />
          </Section>
        </div>

        <Section
          title="Data quality"
          caption="The pins we do not fully believe, and what is wrong with each one."
          className="lg:col-span-2"
        >
          <QualityWorklist rails={rails} />
        </Section>

        <Section
          title="Healing"
          caption="Incident, attempt, canary, receipt."
          className="lg:col-span-2"
        >
          {incidents.length === 0 ? (
            <p className="text-[13px] text-mute">No incidents recorded.</p>
          ) : (
            <div>
              <p className="max-w-[72ch] text-[13px] text-mute">
                {incidents.length} incident{incidents.length === 1 ? "" : "s"} on record. Automatic
                repair is not wired up yet, so nothing here has been healed without a person — and
                the board says so rather than showing an empty timeline that implies it did.
              </p>
              <ul className="mt-3 flex flex-col">
                {incidents.map((incident) => (
                  <li
                    key={incident.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line py-2.5 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <span className="text-broken">broken</span> · {incident.summary}
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
            </div>
          )}
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

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="caps text-ink">{term}</dt>
      <dd className="mt-0.5 text-mute">{children}</dd>
    </div>
  );
}
