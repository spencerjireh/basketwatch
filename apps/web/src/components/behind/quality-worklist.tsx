import type { Rail } from "@basketwatch/contract";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Every pin we do not fully believe, and why.
 *
 * This is the page that answers "how do you know your prices are right", and
 * the honest answer includes the ones that are not. A `suspect` pin is excluded
 * from the basket and from the rails; an `imprecise` one still counts, because
 * the only Philippine banana pin is a 740g-750g range and throwing it away would
 * cost the whole basket to gain a decimal place.
 *
 * It is also a worklist. Each row names a store, a product and a reason, which
 * is enough to go and repoint it.
 */
export function QualityWorklist({ rails }: { rails: Rail[] }) {
  const flagged = rails.flatMap((rail) =>
    rail.pins
      .filter((pin) => pin.flag !== "ok" || pin.unitPrice === null)
      .map((pin) => ({ rail, pin })),
  );

  const thin = rails.filter((rail) => !rail.comparable);

  if (flagged.length === 0 && thin.length === 0) {
    return <p className="text-[13px] text-mute">Every pin checked out. Nothing to review.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="caps">
          {flagged.length} pin{flagged.length === 1 ? "" : "s"} flagged
        </h3>
        <ul className="mt-2.5 flex flex-col">
          {flagged.map(({ rail, pin }) => (
            <li
              key={`${rail.country}:${rail.itemKey}:${pin.storeId}`}
              className="border-b border-line py-2.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]">
                  {rail.itemKey.replace(/_/g, " ")}
                  <span className="ml-2 text-mute">{rail.country}</span>
                </span>
                <span
                  className={cn(
                    "font-mono text-[10.5px]",
                    pin.flag === "suspect" ? "text-broken" : "text-drift",
                  )}
                >
                  {pin.flag === "suspect" ? "excluded" : "counted, imprecise"}
                </span>
              </div>
              <p className="mt-1 truncate text-[13px]">{pin.productName}</p>
              <p className="mt-0.5 font-mono text-[10.5px] text-mute">
                {pin.storeName}
                {pin.unitPrice
                  ? ` · ${formatMoney(pin.unitPrice.amount, pin.unitPrice.currency)}`
                  : " · not priced yet"}
                {rail.medianUnitPrice && pin.unitPrice
                  ? ` · ${(pin.unitPrice.amount / rail.medianUnitPrice.amount).toFixed(1)}x median`
                  : ""}
              </p>
              {pin.flagReason ? (
                <p className="mt-1 text-[12px] text-mute">{pin.flagReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {thin.length > 0 ? (
        <section>
          <h3 className="caps">
            {thin.length} item{thin.length === 1 ? "" : "s"} with too few pins to compare
          </h3>
          <p className="mt-1.5 text-[12.5px] text-mute">
            The outlier rule needs three priced pins to have a median worth measuring against. Below
            that it never fires, so these are unchecked rather than clean.
          </p>
          <p className="mt-2 font-mono text-[10.5px] text-mute">
            {thin
              .map(
                (rail) =>
                  `${rail.itemKey.replace(/_/g, " ")} (${rail.country}, ${rail.pins.filter((p) => p.unitPrice).length} priced)`,
              )
              .join(" · ")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
