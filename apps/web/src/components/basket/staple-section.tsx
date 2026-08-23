"use client";

import type { Rail, RailPin } from "@basketwatch/contract";
import { formatBasis, formatMoney } from "@/lib/format";
import { spread } from "@/lib/scale";
import { cn } from "@/lib/utils";
import { useSelection } from "@/components/terrain/selection";
import { StaplePlate } from "@/components/plates/staple-plate";

/**
 * One staple, as a section the terrain can land on. The header states the
 * verdict -- the winning store and its price -- and the rows below justify it:
 * every store named, ranked cheapest first, with a bar whose length is the
 * ratio to the cheapest from a shared zero. The longest bar in a section is
 * the dearest store; the number after it says exactly how much dearer.
 *
 * Excluded pins are listed underneath as sentences rather than drawn: a
 * seventy-seven-times outlier on the axis would smear the real comparison,
 * and the exclusion is worth reading anyway.
 *
 * The staple's plate sits oversized in the margin, cropped by the row's own
 * edge and alternating sides down the list. It is the one place on this page
 * where the art is allowed to be loud, and it earns it by doing a job: the
 * plate lifts when the row is hovered or landed on from the landscape, which
 * is what makes a click from the massif feel like it arrived somewhere.
 */
/**
 * The plate's own vignette is cropped away by `cover`, so the fade is redrawn
 * here. The centre sits off toward the outer edge but not on it: the row is a
 * column on the page, not the page, so a plate that stayed solid to the edge
 * would end on a hard vertical cut a hundred pixels in from the window.
 */
const edgeFade = (right: boolean) =>
  `radial-gradient(42% 58% at ${right ? "68%" : "32%"} 50%, #000 12%, transparent 100%)`;

export function StapleSection({ rail, index }: { rail: Rail; index: number }) {
  const { hovered, selected, setHovered } = useSelection();

  const drawn = rail.pins
    .filter(
      (pin): pin is RailPin & { unitPrice: NonNullable<RailPin["unitPrice"]> } =>
        pin.flag !== "suspect" && pin.unitPrice !== null,
    )
    .sort((a, b) => a.unitPrice.amount - b.unitPrice.amount);
  const excluded = rail.pins.filter((pin) => pin.flag === "suspect" || pin.unitPrice === null);

  const values = drawn.map((pin) => pin.unitPrice.amount);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const basis = formatBasis(rail.pins.find((p) => p.unitPriceBasis)?.unitPriceBasis ?? null);
  const landed = selected?.itemKey === rail.itemKey && selected.country === rail.country;
  const winner = drawn[0];

  // Row-level attention, derived from the per-pin hover the bars already use.
  // The plate answers to the whole row; the bars keep answering to one pin.
  const attended =
    landed || (hovered?.itemKey === rail.itemKey && hovered.country === rail.country);
  const plateRight = index % 2 === 0;

  return (
    <li
      id={`staple-${rail.itemKey}`}
      className={cn(
        "relative overflow-hidden scroll-mt-24 border-b border-line px-2 py-5 transition-colors duration-700",
        landed ? "bg-wash" : "bg-transparent",
      )}
    >
      {/* Behind everything, and clipped by the row. Cropping the plate to the
          row is the whole placement, but it also crops away the edge fade the
          file carries -- so the fade is redrawn here, radial from the outer
          edge, which holds the art solid where it runs off the page and lets
          it go before it reaches a price. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-[22%] hidden h-[144%] w-[42%] transition-opacity duration-700 sm:block",
          plateRight ? "-right-[7%]" : "-left-[7%]",
          attended ? "opacity-[0.45]" : "opacity-[0.18]",
        )}
        style={{ maskImage: edgeFade(plateRight), WebkitMaskImage: edgeFade(plateRight) }}
      >
        <StaplePlate itemKey={rail.itemKey} fit="cover" />
      </div>

      {/* Everything readable rides above the plate and keeps clear of the
          solid half of it, so a bar never has to be read through a leaf. */}
      <div className={cn("relative", plateRight ? "sm:pr-[26%]" : "sm:pl-[26%]")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="font-display text-[17px]">{rail.label}</h3>
          <p className="font-mono text-[10.5px] text-mute">
            {drawn.length === 0
              ? "no comparable price"
              : drawn.length === 1
                ? "1 store — nothing to compare against"
                : `${drawn.length} stores · ${spread(low, high)} spread`}
          </p>
        </div>

        {winner ? (
          <p className="mt-0.5 text-[13px]">
            <span className="font-medium text-live">{winner.storeName}</span>
            <span className="text-mute"> · </span>
            <span className="font-mono text-[12px]">
              {formatMoney(winner.unitPrice.amount, winner.unitPrice.currency)}
            </span>
            {basis ? <span className="ml-1 font-mono text-[10.5px] text-mute">{basis}</span> : null}
          </p>
        ) : null}

        {drawn.length > 0 ? (
          <ul className="mt-3.5 flex flex-col gap-[7px]">
            {drawn.map((pin) => {
              const ratio = pin.unitPrice.amount / low;
              // The longest bar fills its track; every bar is linear in the
              // ratio, from a shared zero, so lengths compare. Prices live in
              // their own aligned column, so the bar owns the whole lane.
              const width = (ratio / Math.max(high / low, 1)) * 100;
              const isHovered =
                hovered?.itemKey === rail.itemKey &&
                hovered?.storeId === pin.storeId &&
                hovered?.country === rail.country;
              return (
                <li
                  key={`${pin.storeId}:${pin.productKey}`}
                  onMouseEnter={() =>
                    setHovered({
                      country: rail.country,
                      itemKey: rail.itemKey,
                      storeId: pin.storeId,
                    })
                  }
                  onMouseLeave={() => setHovered(null)}
                  className={cn(
                    "grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-x-3 -mx-1 px-1 py-px transition-colors sm:grid-cols-[minmax(0,10rem)_1fr]",
                    isHovered && "bg-wash",
                  )}
                  /*
                   * The row carries the concrete product as a title rather than a
                   * hover card: it is the one place the reader can find out which
                   * exact catalogue item this price belongs to, and it has to
                   * survive touch, keyboard and a screenshot in a demo video.
                   */
                  title={`${pin.productName} — ${formatMoney(
                    pin.unitPrice.amount,
                    pin.unitPrice.currency,
                  )} ${basis}`}
                >
                  <span className={cn("truncate text-[12.5px]", pin.cheapest && "font-medium")}>
                    {pin.storeName}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="relative h-[9px] min-w-0 flex-1">
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0",
                          pin.cheapest
                            ? "bg-live"
                            : pin.flag === "imprecise"
                              ? "bg-drift/80"
                              : "bg-ink/70",
                          isHovered && !pin.cheapest && "bg-ink",
                        )}
                        style={{ width: `${Math.min(100, width).toFixed(2)}%` }}
                      />
                    </span>
                    <span
                      className={cn(
                        "w-[5.5rem] shrink-0 text-right font-mono text-[11px]",
                        pin.cheapest ? "text-live" : "text-ink",
                      )}
                    >
                      {formatMoney(pin.unitPrice.amount, pin.unitPrice.currency)}
                    </span>
                    <span className="w-[3.5rem] shrink-0 font-mono text-[10px]">
                      {pin.cheapest ? (
                        <span className="text-live">cheapest</span>
                      ) : ratio >= 1.05 ? (
                        <span className="text-mute">{ratio.toFixed(1)}x</span>
                      ) : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
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
                {pin.unitPrice
                  ? ` ${formatMoney(pin.unitPrice.amount, pin.unitPrice.currency)}`
                  : pin.price
                    ? ` ${formatMoney(pin.price.amount, pin.price.currency)}`
                    : null}
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
      </div>
    </li>
  );
}
