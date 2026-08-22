"use client";

import { useMemo } from "react";
import { countries, type Rail } from "@basketwatch/contract";
import { useCountry } from "@/components/country/country";
import { basketSpread, rankStores } from "@/lib/basket/store-totals";
import { formatMoney, spellNumber } from "@/lib/format";

/**
 * The title set on the landscape.
 *
 * A claim rather than a caption. "What ten staples cost today" promised a
 * number the hero does not print, so the eye went hunting for one and found a
 * mountain range; what the range actually shows is that no store is lowest
 * across every row, which is worth saying in words.
 *
 * A client leaf, for the same reason the cheapest cart is one: the spread
 * figure is the selected country's, and a flip of the switcher has to repaint
 * it out of data already in hand rather than over the network.
 */

export function HeroCopy({ rails }: { rails: Rail[] }) {
  const { country } = useCountry();

  const spread = useMemo(() => basketSpread(rankStores(rails, country)), [rails, country]);

  // Stores across both countries, which is what the sentence claims. The
  // staple count is the selected country's, because that is the basket the
  // landscape underneath is drawing.
  const totalStores = new Set(rails.flatMap((rail) => rail.pins.map((pin) => pin.storeId))).size;
  const staples = rails.filter((rail) => rail.country === country).length;

  return (
    <>
      <h1 className="font-display text-[38px] leading-[1.05] tracking-[-0.015em] sm:text-[60px]">
        Nobody is cheapest at everything.
      </h1>
      <p className="mt-4 max-w-[46ch] text-[14px] text-mute">
        <span className="capitalize">{spellNumber(staples)}</span> staples priced off the shelf in{" "}
        {totalStores} stores across {spellNumber(countries.length)} countries, at the same
        quantities in each.{" "}
        {/* Dropped on a day too thin to span: a range whose two ends were
            measured over different staples is not a range, and there is no
            honest way to phrase one. */}
        {spread ? (
          <>
            Today the same basket runs{" "}
            <span className="font-mono text-[13px] text-ink">
              {formatMoney(spread.low, spread.currency)}
            </span>{" "}
            to{" "}
            <span className="font-mono text-[13px] text-ink">
              {formatMoney(spread.high, spread.currency)}
            </span>
            .
          </>
        ) : null}
      </p>
    </>
  );
}
