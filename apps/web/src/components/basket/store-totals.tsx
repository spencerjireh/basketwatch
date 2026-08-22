"use client";

import { useMemo } from "react";
import type { Rail } from "@basketwatch/contract";
import { useCountry } from "@/components/country/country";
import { useSelection } from "@/components/terrain/selection";
import { rankStores } from "@/lib/basket/store-totals";
import { RATIO_CAP } from "@/lib/terrain/model";
import { formatMoney, spellNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The landscape's claim, flat and ranked: one bar per store, cheapest first.
 *
 * The relief answers "how far apart are these stores"; this answers "so where
 * do I shop", which is the question a reader actually arrived with. Hovering a
 * bar lights that store's column in the landscape above, through the same
 * selection the terrain's own axis writes to -- one store, pointed at from two
 * places, lit once.
 */
export function StoreTotals({ rails }: { rails: Rail[] }) {
  const { country } = useCountry();
  const { hoveredStore, setHoveredStore } = useSelection();
  const ranking = useMemo(() => rankStores(rails, country), [rails, country]);

  if (ranking.ranked.length === 0) {
    return <p className="text-[13px] text-mute">No store prices enough of the basket to total.</p>;
  }

  // Capped at the same multiple the landscape stops climbing at, so one 20x
  // outlier cannot squash every other bar to a stub. Past the cap the bar is
  // full and the real multiple is printed in the broken colour -- the same
  // bargain the relief strikes with its tallest summit.
  const scale = Math.max(1, ...ranking.ranked.map((store) => Math.min(store.meanRatio, RATIO_CAP)));

  return (
    <div>
      <ul className="flex max-w-[900px] flex-col gap-[7px]">
        {ranking.ranked.map((store, index) => {
          const lit = hoveredStore === store.storeId;
          const cheapest = index === 0;
          const capped = store.meanRatio > RATIO_CAP;
          return (
            <li
              key={store.storeId}
              onMouseEnter={() => setHoveredStore(store.storeId)}
              onMouseLeave={() => setHoveredStore(null)}
              className={cn(
                // Two lines on a phone, one on a page. Four fixed columns and
                // a bar do not share 350px: the bar is what collapses, and a
                // bar chart with no bars is just a table nobody asked for.
                "-mx-1 px-1 py-1.5 transition-colors sm:grid sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-center sm:gap-x-3 sm:py-px",
                lit && "bg-wash",
              )}
              title={`${store.storeName} — ${store.meanRatio.toFixed(
                1,
              )} times the cheapest shelf, ${formatMoney(store.total, ranking.currency)} for ${
                store.covered
              } of ${ranking.priceable} staples`}
            >
              <span className="flex items-baseline justify-between gap-2 sm:block">
                <span className={cn("truncate text-[12.5px]", cheapest && "font-medium")}>
                  {store.storeName}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[11px] sm:hidden",
                    cheapest ? "text-live" : capped ? "text-broken" : "text-mute",
                  )}
                >
                  {store.meanRatio.toFixed(1)}x
                </span>
              </span>
              <span className="mt-1 flex min-w-0 items-center gap-2 sm:mt-0">
                {/* Length is the multiple of the cheapest shelf, averaged --
                    never the raw total. Coverage is uneven and the staples are
                    not interchangeable, so a total rewards a store for what it
                    fails to price and an average staple cost rewards it for
                    pricing only the cheap ones. */}
                <span className="relative h-[9px] min-w-0 flex-1">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0",
                      cheapest ? "bg-live" : lit ? "bg-ink" : "bg-ink/70",
                    )}
                    style={{
                      width: `${((Math.min(store.meanRatio, RATIO_CAP) / scale) * 100).toFixed(2)}%`,
                    }}
                  />
                </span>
                <span
                  className={cn(
                    "hidden w-[3.5rem] shrink-0 font-mono text-[11px] sm:inline",
                    cheapest ? "text-live" : capped ? "text-broken" : "text-ink",
                  )}
                >
                  {store.meanRatio.toFixed(1)}x
                </span>
                <span className="w-[5.5rem] shrink-0 text-right font-mono text-[11px] text-mute">
                  {formatMoney(store.total, ranking.currency)}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[10px] sm:w-[6.5rem]",
                    store.complete ? "text-ink" : "text-mute",
                  )}
                >
                  {store.complete
                    ? `all ${spellNumber(ranking.priceable)}`
                    : `prices ${store.covered} of ${ranking.priceable}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      {ranking.ignored.length > 0 ? (
        /* Named rather than dropped, the way the excluded pins are on every
           staple row: a store the landscape draws and this chart does not owes
           the reader a reason. */
        <ul className="mt-3 flex flex-col gap-1">
          {ranking.ignored.map((store) => (
            /* Mute, not the broken colour: neither of these is a failure. One
               store is outside the index on purpose and the other has nothing
               comparable to say yet. */
            <li key={store.storeId} className="font-mono text-[10.5px] text-mute">
              {store.reason} — <span className="text-ink/70">{store.storeName}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
