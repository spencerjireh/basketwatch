import {
  COUNTRY_NAME,
  DEFAULT_CURRENCY_BY_COUNTRY,
  type BasketItem,
  type BasketPoint,
  type Country,
} from "@basketwatch/contract";
import { formatMoney, formatQuantity } from "@/lib/format";

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
  const currency = items[0]?.price.currency ?? DEFAULT_CURRENCY_BY_COUNTRY[country];
  const priced = new Map(items.map((item) => [item.itemKey, item]));
  const missing = point?.missingItemKeys ?? [];
  const complete = point?.total !== null && point?.total !== undefined;

  return (
    // At full width the receipt splits: lines in columns on the left, the
    // till total as its own right rail. One column across 1240px would run
    // the dotted leaders a thousand pixels from line to price, which is a
    // receipt in name only.
    <div className="min-w-0 lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-x-16">
      <div className="min-w-0">
        <h3 className="font-display text-[18px]">{COUNTRY_NAME[country]}</h3>
        <p className="mt-0.5 text-[12px] text-mute">
          cheapest per unit, across {new Set(items.map((i) => i.cheapestStoreId)).size} stores
        </p>

        <ol className="mt-4 gap-x-16 sm:columns-2">
          {items.map((item) => (
            <li key={item.itemKey} className="mb-1.5 break-inside-avoid">
              <div className="flex items-baseline gap-2">
                <span className="caps shrink-0 text-ink">
                  {item.itemKey.replace(/_/g, " ")}
                  {item.indexQuantity !== null ? (
                    <span className="ml-2 text-mute">
                      {formatQuantity(item.indexQuantity, item.indexUom)}
                    </span>
                  ) : null}
                </span>
                {/* The till-receipt leader: a dotted run from line to price. */}
                <span
                  aria-hidden="true"
                  className="min-w-4 flex-1 self-end border-b border-dotted border-mute/50 mb-[4px]"
                />
                <span className="shrink-0 font-mono text-[12.5px]">
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
              <li key={key} className="mb-1.5 break-inside-avoid opacity-50">
                <div className="flex items-baseline gap-2">
                  <span className="caps shrink-0">{key.replace(/_/g, " ")}</span>
                  <span
                    aria-hidden="true"
                    className="min-w-4 flex-1 self-end border-b border-dotted border-mute/50 mb-[4px]"
                  />
                  <span className="shrink-0 font-mono text-[12.5px]">--</span>
                </div>
                <div className="mt-0.5 text-[11px] text-mute">no usable price today</div>
              </li>
            ))}
        </ol>
      </div>

      {/* The receipt's double rule: the heavier line above the lighter, the
          way a till total is set off from the lines that made it. At width it
          becomes a right rail, so the figure sits beside the lines it totals
          instead of a screen away from them. */}
      <div className="mt-5 self-start border-t border-ink/60 pt-[3px] lg:mt-[52px]">
        <div className="border-t border-ink/20 pt-3">
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
    </div>
  );
}
