"use client";

import { useMemo } from "react";
import { COUNTRY_NAME, countries, type Country, type Rail } from "@basketwatch/contract";
import { useCountry } from "@/components/country/country";
import { Dropdown } from "@/components/ui/dropdown";
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
 * The country name in the sentence is the switcher itself. Once the sentence
 * names one country, every number in it belongs to that country -- store
 * count included -- or the claim reads as a total it no longer is.
 *
 * A client leaf, for the same reason the cheapest cart is one: the spread
 * figure is the selected country's, and a flip of the switcher has to repaint
 * it out of data already in hand rather than over the network.
 */

export function HeroCopy({ rails }: { rails: Rail[] }) {
  const { country, setCountry } = useCountry();

  const spread = useMemo(() => basketSpread(rankStores(rails, country)), [rails, country]);

  const countryRails = rails.filter((rail) => rail.country === country);
  const stores = new Set(countryRails.flatMap((rail) => rail.pins.map((pin) => pin.storeId)))
    .size;
  const staples = countryRails.length;

  return (
    <>
      <h1 className="font-display text-[38px] leading-[1.05] tracking-[-0.015em] sm:text-[60px]">
        Today&apos;s shelf prices for the staples you actually buy.
      </h1>
      {/* A div, not a p: the dropdown renders a div and a ul, which the HTML
          parser would eject from a paragraph and hydration would trip over. */}
      <div className="mt-4 max-w-[46ch] text-[14px] text-mute">
        <span className="capitalize">{spellNumber(staples)}</span> staples priced off the shelf in{" "}
        {stores} stores across the{" "}
        <Dropdown
          label="Country"
          items={countries.map((c) => ({ value: c, label: COUNTRY_NAME[c] }))}
          value={country}
          onChange={(value) => setCountry(value as Country)}
          menuAlign="left"
          // pointer-events-auto and z-[3]: the overlay this sits in is
          // pointer-events-none under the scene's canvas, and the switcher is
          // the one thing in it that must catch a click over the terrain.
          className="pointer-events-auto z-[3] inline-block align-baseline"
        />
        , at the same quantities in each.{" "}
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
      </div>
    </>
  );
}
