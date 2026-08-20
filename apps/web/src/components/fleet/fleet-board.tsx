import type { FleetScraper } from "@basketwatch/contract";
import { RelativeTime } from "@/components/common/relative-time";
import { StatusDot, statusLabel, statusStyle } from "@/components/common/status-dot";
import { cn } from "@/lib/utils";

/**
 * The rack: one shelf-edge strip per store, coloured on its left edge by state.
 *
 * A store is not a scraper. Most stores are pulled over HTTP and have no Studio
 * collector, which is why the collector id is shown only when one exists.
 */
export function FleetBoard({
  fleet,
  onOpenIncident,
}: {
  fleet: FleetScraper[];
  onOpenIncident?: (incidentId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {fleet.map((scraper) => {
        const style = statusStyle(scraper.status);
        return (
          <li key={scraper.storeId} className={cn("shelf-edge px-3 py-2.5", style.edge)}>
            <div className="flex items-center gap-2.5">
              <StatusDot status={scraper.status} />
              <span className="min-w-0 flex-1 truncate font-medium">{scraper.name}</span>
              <span className="font-mono text-[10px] text-mute">{scraper.country}</span>
              <span className={cn("font-mono text-[11px]", style.label)}>
                {statusLabel(scraper.status)}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[18px] font-mono text-[11px] text-mute">
              <span>{scraper.lastRunRows.toLocaleString("en-US")} rows</span>
              <span aria-hidden>·</span>
              <span>{scraper.nullRatePct.toFixed(1)}% null</span>
              {scraper.lastRunAt ? (
                <>
                  <span aria-hidden>·</span>
                  <RelativeTime iso={scraper.lastRunAt} />
                </>
              ) : null}
              {scraper.healsToday > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-heal">
                    {scraper.healsToday} heal{scraper.healsToday === 1 ? "" : "s"} today
                  </span>
                </>
              ) : null}
              {scraper.collectorId ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate opacity-70">{scraper.collectorId}</span>
                </>
              ) : null}
            </div>

            {scraper.openIncidentId && onOpenIncident ? (
              <button
                type="button"
                onClick={() => onOpenIncident(scraper.openIncidentId as string)}
                className="mt-1.5 ml-[18px] rounded border border-line px-2 py-0.5 font-mono text-[10px] text-mute transition-colors hover:border-heal/40 hover:text-heal"
              >
                open audit
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
