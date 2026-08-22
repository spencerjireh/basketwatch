"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Rail } from "@basketwatch/contract";
import { buildTerrainGrid, weatherFor } from "@/lib/terrain/model";
import { useCountry } from "@/components/country/country";
import { SelectionProvider } from "@/components/terrain/selection";
import { TerrainHero } from "@/components/terrain/terrain-hero";
import { StapleSection } from "@/components/basket/staple-section";

/**
 * The one client boundary on the front page. The country arrives from the
 * global provider -- a mode, not a column, because the two currencies are
 * never compared -- so the landscape and the staple sections below it always
 * show the same world as the nav switcher.
 *
 * `hero` and `midBand` are server-rendered content threaded through the
 * client boundary: the headline lives on the full-bleed landscape, and the
 * cheapest cart and time strip sit sandwiched between the landscape and the
 * staple detail -- the answer above, the justification below, and a terrain
 * click scrolls past the answer to land on the evidence.
 */
export function BasketExplorer({
  rails,
  hero,
  midBand,
}: {
  rails: Rail[];
  hero?: ReactNode;
  midBand?: ReactNode;
}) {
  const { country } = useCountry();
  const grid = useMemo(() => buildTerrainGrid(rails, country), [rails, country]);
  const weather = useMemo(() => weatherFor(rails, country), [rails, country]);
  const shown = rails.filter((rail) => rail.country === country);

  return (
    <SelectionProvider>
      {/* The first screenful is the landscape's alone: full bleed, sized in
          svh because the flex-wrap nav above has no fixed height. Everything
          after it returns to the reading column. */}
      <div className="relative h-[64svh] min-h-[440px] max-h-[960px] w-full sm:h-[80svh] sm:min-h-[520px]">
        <TerrainHero grid={grid} weather={weather} overlay={hero} />
      </div>

      <div className="mx-auto w-full max-w-[1240px] px-5">
        {midBand}

        <section className="rule mt-14 pt-4">
          <h2 className="font-display text-[20px] leading-snug">Staple by staple</h2>
          <p className="mt-1 max-w-[64ch] text-[12.5px] text-mute">
            Every usable price, ranked. Bar length is how many times the cheapest store&apos;s
            price; the pins we do not trust are named underneath instead of drawn.
          </p>
          {/* One staple to a row, full width. Two columns fitted more on a
              screen but left the plates nowhere to go, and the walk down ten
              rows is the evidence the landscape above is claiming. */}
          <ul className="mt-4 flex flex-col">
            {shown.map((rail, index) => (
              <StapleSection
                key={`${rail.country}:${rail.itemKey}`}
                rail={rail}
                index={index}
              />
            ))}
          </ul>
        </section>
      </div>
    </SelectionProvider>
  );
}
