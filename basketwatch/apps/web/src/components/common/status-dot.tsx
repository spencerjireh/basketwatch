import type { ScraperState } from "@basketwatch/contract";
import { cn } from "@/lib/utils";

/**
 * One exhaustive record from state to colour. Adding a seventh scraper state
 * becomes a compile error here rather than a silently uncoloured dot.
 */
const STATUS_STYLE: Record<ScraperState, { dot: string; edge: string; label: string }> = {
  healthy: { dot: "bg-live", edge: "border-l-live", label: "text-live" },
  suspect: { dot: "bg-drift", edge: "border-l-drift", label: "text-drift" },
  broken: { dot: "bg-broken", edge: "border-l-broken", label: "text-broken" },
  healing: { dot: "bg-heal", edge: "border-l-heal", label: "text-heal" },
  verifying: { dot: "bg-heal", edge: "border-l-heal", label: "text-heal" },
  manual_attention: { dot: "bg-broken", edge: "border-l-broken", label: "text-broken" },
};

const PULSING: ScraperState[] = ["healing", "verifying"];

export function statusStyle(status: ScraperState) {
  return STATUS_STYLE[status];
}

export function StatusDot({ status }: { status: ScraperState }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        STATUS_STYLE[status].dot,
        PULSING.includes(status) && "animate-pulse motion-reduce:animate-none",
      )}
      aria-hidden
    />
  );
}

/** Reads as words, not as an identifier: "manual attention", not "manual_attention". */
export function statusLabel(status: ScraperState): string {
  return status.replace(/_/g, " ");
}
