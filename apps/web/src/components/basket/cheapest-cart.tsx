"use client";

import type { BasketItem, BasketSeries } from "@basketwatch/contract";
import { useCountry } from "@/components/country/country";
import { BasketTable } from "@/components/basket/basket-table";

/**
 * The cheapest cart for the selected country. The server hands down every
 * country's items in one fetch; this leaf picks the one the nav switcher
 * says, so a flip repaints without a network round trip.
 */
export function CheapestCart({
  items,
  index,
}: {
  items: BasketItem[];
  index: BasketSeries[];
}) {
  const { country } = useCountry();
  const shown = items.filter((item) => item.country === country);
  const series = index.find((s) => s.country === country);

  if (shown.length === 0) {
    return <p className="text-[13px] text-mute">No priced basket for this country yet.</p>;
  }

  return (
    <div className="max-w-[560px]">
      <BasketTable country={country} items={shown} point={series?.points.at(-1)} />
    </div>
  );
}
