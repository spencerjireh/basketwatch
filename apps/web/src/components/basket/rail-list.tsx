"use client";

import { useState } from "react";
import type { Country, Rail } from "@basketwatch/contract";
import { PriceRail } from "@/components/basket/price-rail";
import { cn } from "@/lib/utils";

/**
 * Rails, one country at a time.
 *
 * Both countries at once is twenty strips with "Bananas per kg" appearing twice
 * and no way to tell which is which. The prices are in different currencies and
 * are not being compared across the divide anyway -- only within it -- so the
 * country is a mode, not a column.
 */
export function RailList({ rails }: { rails: Rail[] }) {
  const countries = [...new Set(rails.map((rail) => rail.country))] as Country[];
  const [active, setActive] = useState<Country | undefined>(countries[0]);
  const shown = rails.filter((rail) => rail.country === active);

  return (
    <div>
      {countries.length > 1 ? (
        <div className="mb-3 flex gap-1" role="tablist" aria-label="Country">
          {countries.map((country) => (
            <button
              key={country}
              type="button"
              role="tab"
              aria-selected={country === active}
              onClick={() => setActive(country)}
              className={cn(
                "rounded border px-2.5 py-1 font-mono text-[11px] transition-colors",
                country === active
                  ? "border-heal/40 bg-heal/10 text-heal"
                  : "border-line text-mute hover:text-chalk",
              )}
            >
              {country}
            </button>
          ))}
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {shown.map((rail) => (
          <PriceRail key={`${rail.country}:${rail.itemKey}`} rail={rail} />
        ))}
      </ul>
    </div>
  );
}
