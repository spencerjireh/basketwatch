"use client";

import type { FeedEvent, FeedEventKind } from "@basketwatch/contract";
import { RelativeTime } from "@/components/common/relative-time";
import { cn } from "@/lib/utils";

/** Exhaustive over the contract, so a new event kind is a compile error. */
const KIND_STYLE: Record<FeedEventKind, { rail: string; label: string }> = {
  breakage: { rail: "bg-broken", label: "text-broken" },
  healing: { rail: "bg-heal", label: "text-heal" },
  healed: { rail: "bg-live", label: "text-live" },
  price_drop: { rail: "bg-drift", label: "text-drift" },
  escalation: { rail: "bg-broken", label: "text-broken" },
};

const KIND_LABEL: Record<FeedEventKind, string> = {
  breakage: "broke",
  healing: "healing",
  healed: "healed",
  price_drop: "price drop",
  escalation: "needs a person",
};

export function EventFeed({
  events,
  onOpenIncident,
}: {
  events: FeedEvent[];
  onOpenIncident?: (incidentId: string) => void;
}) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-mute">
        Nothing has happened yet. Activity appears here as runs land.
      </p>
    );
  }

  return (
    <ul className="flex max-h-[420px] flex-col overflow-y-auto">
      {events.map((event) => {
        const style = KIND_STYLE[event.kind];
        return (
          <li
            key={event.id}
            className="grid grid-cols-[10px_1fr] gap-2.5 border-b border-line py-2.5 last:border-b-0"
          >
            <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full", style.rail)} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-mute">
                <RelativeTime iso={event.at} />
                <span aria-hidden>·</span>
                <span className="truncate">{event.storeName}</span>
                <span className={style.label}>{KIND_LABEL[event.kind]}</span>
              </div>
              <p className="mt-0.5 text-[13px]">{event.summary}</p>
              {event.incidentId && onOpenIncident ? (
                <button
                  type="button"
                  onClick={() => onOpenIncident(event.incidentId as string)}
                  className="mt-1 font-mono text-[10px] text-mute underline decoration-dotted underline-offset-2 transition-colors hover:text-heal"
                >
                  open audit
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
