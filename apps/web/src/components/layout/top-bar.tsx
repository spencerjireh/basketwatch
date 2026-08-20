import type { CreditBudget, FleetScraper } from "@basketwatch/contract";
import { Pill } from "@/components/ui/pill";
import { formatMoney } from "@/lib/format";

export function TopBar({ fleet, budget }: { fleet: FleetScraper[]; budget: CreditBudget }) {
  const healthy = fleet.filter((s) => s.status === "healthy").length;
  const attention = fleet.length - healthy;
  const spentShare = budget.spentToday.amount / budget.dailyCeiling.amount;

  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] [font-stretch:expanded]">
          Basketwatch
        </h1>
        <p className="mt-0.5 max-w-[46ch] text-[13px] text-mute">
          The basket index that shows its own gaps. When a scraper breaks, the line stops rather
          than guessing.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Pill className="text-live">
          <span className="size-1.5 rounded-full bg-live" aria-hidden />
          {healthy} healthy
        </Pill>
        {attention > 0 ? (
          <Pill className="text-drift">
            <span className="size-1.5 rounded-full bg-drift" aria-hidden />
            {attention} need attention
          </Pill>
        ) : null}
        <Pill className={spentShare > 0.8 ? "text-broken" : "text-mute"}>
          {formatMoney(budget.spentToday.amount, budget.spentToday.currency)} of{" "}
          {formatMoney(budget.dailyCeiling.amount, budget.dailyCeiling.currency)} today
        </Pill>
      </div>
    </header>
  );
}
