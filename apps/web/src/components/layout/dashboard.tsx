"use client";

import { useMemo, useState } from "react";
import type {
  BasketItem,
  BasketSeries,
  CreditBudget,
  FeedEvent,
  FleetScraper,
  Incident,
} from "@basketwatch/contract";
import { IndexChart } from "@/components/basket/index-chart";
import { BasketTable } from "@/components/basket/basket-table";
import { EventFeed } from "@/components/feed/event-feed";
import { FleetBoard } from "@/components/fleet/fleet-board";
import { AuditDialog } from "@/components/incident/audit-dialog";
import { TopBar } from "@/components/layout/top-bar";
import { Panel } from "@/components/ui/panel";

/**
 * The board.
 *
 * Client-side because the audit dialog is shared state across three panels: the
 * fleet board, the feed and the chart all open the same receipt. The data still
 * arrives from a server component above, so the first paint is server-rendered.
 */
export function Dashboard({
  fleet,
  basketIndex,
  basketItems,
  feed,
  incidents,
  budget,
}: {
  fleet: FleetScraper[];
  basketIndex: BasketSeries[];
  basketItems: BasketItem[];
  feed: FeedEvent[];
  incidents: Incident[];
  budget: CreditBudget;
}) {
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);

  const openIncident = useMemo(
    () => incidents.find((incident) => incident.id === openIncidentId) ?? null,
    [incidents, openIncidentId],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] px-5 pb-20 pt-6">
      <TopBar fleet={fleet} budget={budget} />

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Basket index"
          caption="Total price of the tracked staples. A hatched span is a scraper outage, not a price of zero."
        >
          <IndexChart series={basketIndex} />
        </Panel>

        <Panel title="Fleet" caption="One strip per store, coloured by state.">
          <FleetBoard fleet={fleet} onOpenIncident={setOpenIncidentId} />
        </Panel>

        <Panel title="Cheapest today" caption="Unit price underneath, so pack sizes compare.">
          <BasketTable items={basketItems} />
        </Panel>

        <Panel title="Activity">
          <EventFeed events={feed} onOpenIncident={setOpenIncidentId} />
        </Panel>
      </div>

      <AuditDialog incident={openIncident} onClose={() => setOpenIncidentId(null)} />
    </main>
  );
}
