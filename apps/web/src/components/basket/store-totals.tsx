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
 * The landscape's claim, flat and ranked: one row per store, cheapest first.
 *
 * The old bar here re-told the hero's ordering and nothing else, and told it
 * badly: a bar from zero on a metric that cannot go below 1x spends most of
 * its length on ground no store can stand on. This is a dot plot instead. The
 * filled dot is the store's average multiple of the cheapest shelf -- the same
 * figure the bar encoded -- and around it, one thin tick per staple. The
 * spread of the ticks is the fact the relief cannot be read for: a tight clump
 * is a store that is what it is on everything, a scattered row is a store
 * whose answer depends on what you buy.
 *
 * Hovering a row lights that store's column in the landscape above, through
 * the same selection the terrain's own axis writes to -- one store, pointed at
 * from two places, lit once.
 */

/** Position on the track: 1.0x at the left edge, `axisMax` at the right. */
function place(ratio: number, axisMax: number): number {
  return ((Math.min(ratio, axisMax) - 1) / (axisMax - 1)) * 100;
}

/**
 * A near-flat market still deserves a readable spread, so the axis never
 * closes tighter than this. Without a floor, two stores at 1.02x and 1.04x
 * would sit at opposite ends of the track and the plot would shout about
 * nothing.
 */
const AXIS_FLOOR = 1.5;

export function StoreTotals({ rails }: { rails: Rail[] }) {
  const { country } = useCountry();
  const { hoveredStore, setHoveredStore } = useSelection();
  const ranking = useMemo(() => rankStores(rails, country), [rails, country]);

  // The axis runs to the dearest mark the cap admits, and no further. A mark
  // past RATIO_CAP -- the multiple the landscape stops climbing at -- does not
  // stretch the axis: it clamps flush right in the broken colour with the real
  // multiple printed, the same bargain the relief strikes with its tallest
  // summit. Letting an outlier set the scale is the old bar chart's failure
  // reversed -- one 9x staple would cram every honest difference into the
  // left eighth of the track.
  const { axisMax, anyCapped } = useMemo(() => {
    let max = AXIS_FLOOR;
    let clamped = false;
    for (const store of ranking.ranked) {
      for (const staple of store.staples) {
        if (staple.ratio > RATIO_CAP) clamped = true;
        else max = Math.max(max, staple.ratio);
      }
    }
    return { axisMax: max, anyCapped: clamped };
  }, [ranking]);

  if (ranking.ranked.length === 0) {
    return <p className="text-[13px] text-mute">No store prices enough of the basket to total.</p>;
  }

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
                // a track do not share 350px: the track is what collapses,
                // and ticks survive a narrow track better than bars did.
                "-mx-1 px-1 py-1.5 transition-colors sm:grid sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-center sm:gap-x-3 sm:py-px",
                lit && "bg-wash",
              )}
              title={`${store.storeName} — ${store.meanRatio.toFixed(
                1,
              )} times the cheapest shelf on average, ${formatMoney(
                store.total,
                ranking.currency,
              )} for ${store.covered} of ${ranking.priceable} staples`}
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
                {/* The track runs 1.0x to the dearest staple anyone prices,
                    never from zero: everything below 1x is ground no store
                    can stand on, and a bar that starts there spends two
                    thirds of its length saying nothing. */}
                <span className="relative h-[13px] min-w-0 flex-1">
                  {/* Hairline baseline, so a row whose marks sit far apart
                      still reads as one row and not two accidents. */}
                  <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
                  {store.staples.map((staple) => {
                    const stapleCapped = staple.ratio > RATIO_CAP;
                    return (
                      <span
                        key={staple.itemKey}
                        title={`${staple.label} — ${staple.ratio.toFixed(1)}x the cheapest shelf`}
                        className={cn(
                          "absolute inset-y-[2px] w-[2px] -translate-x-1/2",
                          stapleCapped ? "bg-broken" : lit ? "bg-ink/60" : "bg-ink/35",
                        )}
                        style={{ left: `${place(staple.ratio, axisMax).toFixed(2)}%` }}
                      />
                    );
                  })}
                  {/* The mean, drawn last so no tick can cover it. It is the
                      figure printed beside the row and the one the landscape's
                      column order is sorted by. */}
                  <span
                    className={cn(
                      "absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full",
                      capped ? "bg-broken" : cheapest ? "bg-live" : lit ? "bg-ink" : "bg-ink/80",
                    )}
                    style={{ left: `${place(store.meanRatio, axisMax).toFixed(2)}%` }}
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

      {/* The scale, said once under the plot rather than re-derived per row.
          Left edge and right edge only: a full ruler under a chart this small
          is furniture, and the marks themselves are labeled on hover. The
          padding mirrors the row's columns -- name on the left, multiple,
          money, and coverage on the right, gaps included -- so the two labels
          sit under the track's own ends and nothing else's. */}
      <div className="mt-1.5 flex max-w-[900px] font-mono text-[10px] text-mute sm:pl-[calc(11rem+0.75rem)] sm:pr-[calc(3.5rem+5.5rem+6.5rem+1.5rem)]">
        <span>1x — the cheapest shelf</span>
        {/* The plus is a promise, not a rounding: marks past the cap sit on
            this edge, and their true multiples are printed in red beside
            their rows. */}
        <span className="ml-auto">
          {anyCapped ? `${axisMax.toFixed(1)}x+` : `${axisMax.toFixed(1)}x`}
        </span>
      </div>

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
