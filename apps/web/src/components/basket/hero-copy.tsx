"use client";

import { useMemo } from "react";
import { COUNTRY_NAME, type Rail } from "@basketwatch/contract";
import { useCountry } from "@/components/country/country";
import { basketSpread, rankStores } from "@/lib/basket/store-totals";
import { formatMoney, spellNumber } from "@/lib/format";

/**
 * The title set on the landscape.
 *
 * A label rather than a claim. "Nobody is cheapest at everything" was the
 * finding, and a reader who already knew the product enjoyed it; a reader
 * arriving cold could not tell groceries from insurance. The title now says
 * what is on screen -- today's shelf prices, staples -- and leaves the
 * finding to the range itself. It stops short of promising a specific
 * number, the trap "What ten staples cost today" fell into: the spread in
 * the paragraph below prints on good days and is dropped on thin ones, so
 * the headline cannot owe a figure the page may not show.
 *
 * The sentence names the country, so every number in it belongs to that
 * country -- store count included -- or the claim reads as a total it is not.
 *
 * A client leaf, for the same reason the cheapest cart is one: the spread
 * figure is the selected country's, and a flip of the switcher has to repaint
 * it out of data already in hand rather than over the network.
 */

export function HeroCopy({ rails }: { rails: Rail[] }) {
  const { country } = useCountry();

  const spread = useMemo(() => basketSpread(rankStores(rails, country)), [rails, country]);

  const countryRails = rails.filter((rail) => rail.country === country);
  const stores = new Set(countryRails.flatMap((rail) => rail.pins.map((pin) => pin.storeId))).size;
  const staples = countryRails.length;

  return (
    <>
      <h1 className="font-display text-[38px] leading-[1.05] tracking-[-0.015em] sm:text-[60px]">
        Today&apos;s shelf prices for the staples you actually buy.
      </h1>
      <p className="mt-4 max-w-[46ch] text-[14px] text-mute">
        <span className="capitalize">{spellNumber(staples)}</span> staples priced off the shelf in{" "}
        {stores} stores across the {COUNTRY_NAME[country]}, at the same quantities in each.{" "}
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
