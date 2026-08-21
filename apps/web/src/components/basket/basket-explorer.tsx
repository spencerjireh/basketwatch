"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Rail } from "@basketwatch/contract";
import { buildTerrainGrid } from "@/lib/terrain/model";
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
 * `midBand` is server-rendered content (the cheapest cart, the time strip)
 * sandwiched between the landscape and the staple detail: the answer sits
 * above, the justification below, and a terrain click scrolls past the
 * answer to land on the evidence.
 */
export function BasketExplorer({ rails, midBand }: { rails: Rail[]; midBand?: ReactNode }) {
  const { country } = useCountry();
  const grid = useMemo(() => buildTerrainGrid(rails, country), [rails, country]);
  const shown = rails.filter((rail) => rail.country === country);

  return (
    <SelectionProvider>
      <div className="mt-4">
        <TerrainHero grid={grid} />
      </div>

      {midBand}

      <section className="rule mt-14 pt-4">
        <h2 className="font-display text-[20px] leading-snug">Staple by staple</h2>
        <p className="mt-1 max-w-[64ch] text-[12.5px] text-mute">
          Every usable price, ranked. Bar length is how many times the cheapest store&apos;s
          price; the pins we do not trust are named underneath instead of drawn.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-x-16 sm:grid-cols-2">
          {shown.map((rail) => (
            <StapleSection key={`${rail.country}:${rail.itemKey}`} rail={rail} />
          ))}
        </ul>
      </section>
    </SelectionProvider>
  );
}
