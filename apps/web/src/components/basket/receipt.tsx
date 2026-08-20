import type { BasketItem, BasketPoint, Country } from "@basketwatch/contract";
import { formatMoney } from "@/lib/format";

const COUNTRY_NAME: Record<Country, string> = {
  US: "United States",
  PH: "Philippines",
};

/**
 * The basket as a receipt.
 *
 * A receipt is what this data already is: a list of staples, a price against
 * each, a total at the bottom. The tape material exists in globals.css and until
 * now only the heal audit used it, which had the itemised ledger dressed as a
 * ledger and the shopping list dressed as a chart.
 *
 * Every line names the product it was priced from. That is not garnish. Ranking
 * by unit price surfaces mispins that ranking by sticker price hid -- a can of
 * pozole can win "chicken" because it is cheap per kilo -- and no threshold rule
 * catches those. Printing the name is the only thing that makes them visible.
 */
export function Receipt({
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
    <div className="receipt flex flex-col rounded-t-[3px] px-5 pb-6 pt-5 text-[13px] leading-snug">
      <h3 className="text-center text-[11px] uppercase tracking-[0.24em]">
        {COUNTRY_NAME[country]}
      </h3>
      <p className="mt-1 text-center text-[10.5px] opacity-60">
        cheapest per unit, across {new Set(items.map((i) => i.cheapestStoreId)).size} stores
      </p>

      <ol className="mt-5 flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.itemKey}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="uppercase tracking-[0.08em]">
                {item.itemKey.replace(/_/g, " ")}
                {item.indexQuantity !== null ? (
                  <span className="ml-2 opacity-55">
                    {formatQuantity(item.indexQuantity, item.indexUom)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {item.indexContribution
                  ? formatMoney(item.indexContribution.amount, item.indexContribution.currency)
                  : "--"}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] opacity-60">
              {item.productName} &middot; {item.cheapestStoreName}
              {item.imprecise ? " · approx size" : ""}
            </div>
          </li>
        ))}

        {missing
          .filter((key) => !priced.has(key))
          .map((key) => (
            <li key={key} className="opacity-45">
              <div className="flex items-baseline justify-between gap-3">
                <span className="uppercase tracking-[0.08em]">{key.replace(/_/g, " ")}</span>
                <span className="shrink-0">--</span>
              </div>
              <div className="mt-0.5 text-[11px]">no usable price today</div>
            </li>
          ))}
      </ol>

      <div className="receipt-rule mt-5 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] uppercase tracking-[0.18em]">Total</span>
          {complete ? (
            <span className="text-[19px] font-bold tabular-nums">
              {formatMoney(point.total as number, currency)}
            </span>
          ) : (
            /*
             * A partial basket is not a cheaper basket, so there is no number
             * here at all. The slot says why it is empty rather than going
             * blank, which is the difference between a gap and a bug.
             */
            <span className="text-[12px] opacity-70">no full basket today</span>
          )}
        </div>
        <p className="mt-1.5 text-[10.5px] opacity-60">
          {point ? `${point.pricedItems} of ${point.expectedItems} staples priced` : "no reading"}
        </p>
      </div>
    </div>
  );
}

/** "0.5 kg" reads worse than "500 g" on a shelf, and this is a shelf. */
function formatQuantity(quantity: number, uom: string | null): string {
  if (uom === "count") return `${quantity}`;
  if (uom === "kg" && quantity < 1) return `${Math.round(quantity * 1000)} g`;
  if (uom === "l" && quantity < 1) return `${Math.round(quantity * 1000)} ml`;
  return `${quantity} ${uom ?? ""}`.trim();
}
