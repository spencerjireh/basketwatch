import type { Rail, RailPin } from "@basketwatch/contract";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const BASIS_LABEL: Record<string, string> = {
  per_kg: "per kg",
  per_litre: "per litre",
  per_item: "each",
};

/**
 * The shelf-edge label, blown up into a chart.
 *
 * One strip per staple, one dot per store, positioned by unit price. This is the
 * question nineteen stores can answer today and three days of history cannot:
 * not how a price moved, but how far apart the same thing is priced right now.
 *
 * The axis is logarithmic because real spreads run fifty-fold -- Philippine
 * coffee spans PHP 757 to PHP 7,107 per kilo -- and on a linear axis every dot
 * but the dearest collapses into the left margin.
 *
 * Excluded pins are listed underneath rather than drawn on the strip. Putting a
 * seventy-seven-times outlier on the axis would stretch the scale until the real
 * comparison became a single smear, and the exclusion is worth reading as a
 * sentence anyway.
 */
export function PriceRail({ rail }: { rail: Rail }) {
  const drawn = rail.pins.filter(
    (pin): pin is RailPin & { unitPrice: NonNullable<RailPin["unitPrice"]> } =>
      pin.flag !== "suspect" && pin.unitPrice !== null,
  );
  const excluded = rail.pins.filter((pin) => pin.flag === "suspect" || pin.unitPrice === null);

  const values = drawn.map((pin) => pin.unitPrice.amount);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const basis = BASIS_LABEL[rail.pins.find((p) => p.unitPriceBasis)?.unitPriceBasis ?? ""] ?? "";

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.12em]">
          {rail.label}
          {basis ? <span className="ml-2 text-mute">{basis}</span> : null}
        </h3>
        <p className="font-mono text-[10.5px] text-mute">
          {drawn.length === 0
            ? "no comparable price"
            : drawn.length === 1
              ? "1 store — nothing to compare against"
              : `${drawn.length} stores · ${spread(low, high)} spread`}
        </p>
      </div>

      {drawn.length > 0 ? (
        <div className="mt-3">
          <div className="relative h-7">
            <div className="absolute inset-x-0 top-3 h-px bg-line" />
            {drawn.map((pin) => {
              const left = position(pin.unitPrice.amount, low, high);
              return (
                <span
                  key={`${pin.storeId}:${pin.productKey}`}
                  className="absolute top-3 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${left}%` }}
                  /*
                   * The dot carries the whole row as a title rather than a
                   * hover card: it is the one place the reader can find out
                   * which concrete product this price belongs to, and it has to
                   * survive touch, keyboard and a screenshot in a demo video.
                   */
                  title={`${pin.storeName} — ${pin.productName} — ${formatMoney(
                    pin.unitPrice.amount,
                    pin.unitPrice.currency,
                  )} ${basis}`}
                >
                  <span
                    className={cn(
                      "block size-2 rounded-full",
                      pin.cheapest ? "bg-live ring-2 ring-live/25" : "bg-heal",
                      pin.flag === "imprecise" && "bg-drift",
                    )}
                  />
                </span>
              );
            })}
          </div>

          <div className="flex items-baseline justify-between gap-3 font-mono text-[10.5px]">
            <span className="min-w-0 truncate text-live">
              {formatMoney(low, rail.currency)}
              <span className="ml-1.5 text-mute">
                {drawn.find((p) => p.cheapest)?.storeName ?? ""}
              </span>
            </span>
            {drawn.length > 1 ? (
              <span className="min-w-0 truncate text-right text-mute">
                {formatMoney(high, rail.currency)}
                <span className="ml-1.5">{drawn.find((p) => p.dearest)?.storeName ?? ""}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {excluded.length > 0 ? (
        <ul className="mt-2.5 flex flex-col gap-1">
          {excluded.map((pin) => (
            <li
              key={`${pin.storeId}:${pin.productKey}`}
              className="font-mono text-[10.5px] text-mute"
            >
              {/*
               * Two different absences, and conflating them reads as a
               * contradiction: a pin with no observation at all has nothing to
               * say about its size, while one with a sticker price but no unit
               * price has a reason worth printing.
               */}
              <span className={pin.price === null ? "text-mute" : "text-broken"}>
                {pin.price === null ? "not priced yet" : "excluded"}
              </span>{" "}
              {pin.storeName}
              {pin.unitPrice ? (
                ` ${formatMoney(pin.unitPrice.amount, pin.unitPrice.currency)}`
              ) : pin.price ? (
                ` ${formatMoney(pin.price.amount, pin.price.currency)}`
              ) : null}
              {pin.price !== null && pin.flagReason ? ` — ${pin.flagReason}` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {!rail.comparable && drawn.length > 0 ? (
        /*
         * Below three priced pins the outlier rule never fires. Saying so is the
         * difference between "these were checked and passed" and "there was
         * nothing to check them against", and only one of those is true.
         */
        <p className="mt-2 font-mono text-[10.5px] text-mute">
          too few pins to judge an outlier here
        </p>
      ) : null}
    </li>
  );
}

/**
 * Log position, because a linear axis puts every dot but the dearest at zero.
 *
 * Rounded to a fixed precision, and that is a correctness fix rather than
 * tidiness: React serialises a raw float into a style string differently on the
 * server than in the browser, so an unrounded percentage hydrates as a mismatch.
 */
function position(value: number, low: number, high: number): string {
  if (high <= low) return "50";
  const ratio = (Math.log(value) - Math.log(low)) / (Math.log(high) - Math.log(low));
  return (ratio * 100).toFixed(3);
}

function spread(low: number, high: number): string {
  if (low <= 0) return "";
  const times = high / low;
  return times >= 2 ? `${times.toFixed(1)}x` : `${Math.round((times - 1) * 100)}%`;
}
