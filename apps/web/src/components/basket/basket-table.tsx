import type { BasketItem, BasketPoint, Country } from "@basketwatch/contract";
import { formatMoney, formatQuantity } from "@/lib/format";

const COUNTRY_NAME: Record<Country, string> = {
  US: "United States",
  PH: "Philippines",
};

/**
 * The basket as a table: staples down, the cheapest usable price against each,
 * the total set large. Every line names the product it was priced from -- that
 * is not garnish. Ranking by unit price surfaces mispins that ranking by
 * sticker price hid, and printing the name is the only thing that makes them
 * visible.
 */
export function BasketTable({
  country,
  items,
  point,
}: {
  country: Country;
  items: BasketItem[];
  /** the latest day on the index, which is where the total and coverage come from */
  point: BasketPoint | undefined;
}) {
  const currency = items[0]?.price.currency ?? "USD";
  const priced = new Map(items.map((item) => [item.itemKey, item]));
  const missing = point?.missingItemKeys ?? [];
  const complete = point?.total !== null && point?.total !== undefined;

  return (
    <div className="min-w-0">
      <h3 className="font-display text-[18px]">{COUNTRY_NAME[country]}</h3>
      <p className="mt-0.5 text-[12px] text-mute">
        cheapest per unit, across {new Set(items.map((i) => i.cheapestStoreId)).size} stores
      </p>

      <ol className="mt-4 flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item.itemKey}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="caps text-ink">
                {item.itemKey.replace(/_/g, " ")}
                {item.indexQuantity !== null ? (
                  <span className="ml-2 text-mute">
                    {formatQuantity(item.indexQuantity, item.indexUom)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-mono text-[13px]">
                {item.indexContribution
                  ? formatMoney(item.indexContribution.amount, item.indexContribution.currency)
                  : "--"}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-mute">
              {item.productName} &middot; {item.cheapestStoreName}
              {item.imprecise ? " · approx size" : ""}
            </div>
          </li>
        ))}

        {missing
          .filter((key) => !priced.has(key))
          .map((key) => (
            <li key={key} className="opacity-50">
              <div className="flex items-baseline justify-between gap-3">
                <span className="caps">{key.replace(/_/g, " ")}</span>
                <span className="shrink-0 font-mono text-[13px]">--</span>
              </div>
              <div className="mt-0.5 text-[11px] text-mute">no usable price today</div>
            </li>
          ))}
      </ol>

      <div className="rule mt-5 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="caps">Total</span>
          {complete ? (
            <span className="font-display text-[38px] leading-none">
              {formatMoney(point.total as number, currency)}
            </span>
          ) : (
            /*
             * A partial basket is not a cheaper basket, so there is no number
             * here at all. The slot says why it is empty rather than going
             * blank, which is the difference between a gap and a bug.
             */
            <span className="text-[12px] text-mute">no full basket today</span>
          )}
        </div>
        <p className="mt-1.5 text-right font-mono text-[10.5px] text-mute">
          {point ? `${point.pricedItems} of ${point.expectedItems} staples priced` : "no reading"}
        </p>
      </div>
    </div>
  );
}
