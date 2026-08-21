import type { FleetScraper } from "@basketwatch/contract";
import { RelativeTime } from "@/components/common/relative-time";
import { StatusDot, statusLabel, statusStyle } from "@/components/common/status-dot";
import { cn } from "@/lib/utils";

/**
 * The rack: one hairline row per store, state carried by the coloured word.
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
    <ul className="flex flex-col">
      {fleet.map((scraper) => {
        const style = statusStyle(scraper.status);
        return (
          <li key={scraper.storeId} className="border-b border-line py-2.5 last:border-b-0">
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
                className="mt-1.5 ml-[18px] font-mono text-[11px] text-mute underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
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
