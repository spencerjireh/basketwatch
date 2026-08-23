"use client";

import { useId, useMemo, useState } from "react";
import { COUNTRY_NAME, type BasketSeries, type StoreSeries } from "@basketwatch/contract";
import { useCountry } from "@/components/country/country";
import { useSelection } from "@/components/terrain/selection";
import { formatDay, formatMoney, formatMoneyAxis } from "@/lib/format";

const W = 960;
const H = 320;
const PAD_L = 56;
/* The right gutter is for direct store labels. A legend box would make the
   reader carry a colour table in their head; a name at the end of its own
   line asks nothing. */
const PAD_R = 140;
const PAD_T = 24;
const PAD_B = 36;

/**
 * The basket over time, drawn by hand instead of by a charting library --
 * the axis, the labels, and the honesty rules below are the component.
 *
 * Every price chart on the internet draws a smooth line, and a smooth line
 * lies: it interpolates across the days a scraper was broken. This one stops.
 * The missing span is hatched in the broken colour and labelled with the
 * incident that caused it, and the line resumes where the heal closed the gap.
 *
 * Behind the basket line, one thin line per store: that store's own sum over
 * the staples it priced. A store line does not go quiet on a partial day --
 * its claim is only "what this store charged for what it had" -- but the
 * segment dims and the point goes hollow, so a thin faint stretch reads as a
 * store being flaky rather than a store being cheap.
 */
export function IndexPanorama({ series }: { series: BasketSeries[] }) {
  const { country } = useCountry();
  const { hoveredStore, setHoveredStore } = useSelection();
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const hatchId = useId();

  const active = series.find((s) => s.country === country);
  const gaps = useMemo(() => findGaps(active), [active]);

  if (!active) {
    return (
      <p className="font-mono text-[10.5px] text-mute">
        No index readings for {COUNTRY_NAME[country]} yet.
      </p>
    );
  }

  const points = active.points;
  const stores = active.stores ?? [];
  const readings = points.filter((p) => p.total !== null).length;

  // A store whose sum dwarfs the basket demands an axis that flattens every
  // other line into the floor -- one 16x import store and the chart becomes a
  // portrait of it. Past the cap the store is left off the chart and never
  // allowed to set the scale.
  const drawnStores = stores.filter((s) => storeRatio(s, points) <= CHART_CAP);

  // The y domain covers every drawn value: the basket and the drawn store
  // sums, partial days included -- a clipped point would look like a missing
  // one.
  const drawn = [
    ...points.map((p) => p.total),
    ...drawnStores.flatMap((s) => s.points.map((p) => p.total)),
  ].filter((t): t is number => t !== null);
  const span = drawn.length > 0 ? Math.max(...drawn) - Math.min(...drawn) : 0;
  const pad = span > 0 ? span * 0.08 : Math.max(...drawn, 1) * 0.1;
  const lo = drawn.length > 0 ? Math.min(...drawn) - pad : 0;
  const hi = drawn.length > 0 ? Math.max(...drawn) + pad : 1;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? PAD_L + i * step : PAD_L + innerW / 2);
  const y = (v: number) => (hi > lo ? PAD_T + (1 - (v - lo) / (hi - lo)) * innerH : H / 2);
  const dateIndex = new Map(points.map((p, i) => [p.date, i]));

  const ticks = niceTicks(lo, hi, 4);
  // Every day gets a label while history is short; past ten or so, a stride
  // keeps the ruler legible and the latest day always keeps its label.
  const stride = Math.max(1, Math.ceil(points.length / 10));

  // The basket's own value labels: only the poles. The present is not marked
  // on the point -- the gutter label carries it -- and a figure on every point
  // stops scaling past a week and buries the shape it labels.
  const totals = points.map((p) => p.total);
  const marked = new Map<number, string>();
  if (readings > 1) {
    const valued = totals.filter((t): t is number => t !== null);
    const minIdx = totals.indexOf(Math.min(...valued));
    const maxIdx = totals.indexOf(Math.max(...valued));
    if (minIdx !== maxIdx) {
      marked.set(minIdx, "lowest");
      marked.set(maxIdx, "highest");
    }
  }

  const labels = placeLabels(active, drawnStores, y);
  const hoveredPoint = hoveredDay !== null ? points[hoveredDay] : undefined;
  const hotSeries = hoveredStore ? drawnStores.find((s) => s.storeId === hoveredStore) : undefined;

  return (
    <div className="flex flex-col">
      {/* On a phone the panorama scrolls sideways instead of shrinking its
          type below reading size -- a chart nobody can read is not honest,
          it is just small. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[720px]"
          role="img"
          aria-label="Basket total by day, with each store's own line behind it"
          onPointerLeave={() => setHoveredDay(null)}
        >
          <defs>
            {/* The scar, in two registers. Hatching rather than a fill, so a
                gap reads as absence instead of as a value of zero -- and the
                broken colour only where an incident owns the gap. A day with
                no incident is not a failure, it is a day we make no claim
                about, and painting it alarm-red would spend the state
                machine's word on nothing. Faint on purpose either way: the
                hatch marks the span, the label and the readout carry the
                story. */}
            <pattern
              id={`${hatchId}-broken`}
              width="8"
              height="8"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="var(--color-broken)"
                strokeOpacity="0.12"
                strokeWidth="2"
              />
            </pattern>
            <pattern
              id={`${hatchId}-absent`}
              width="8"
              height="8"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="var(--color-mute)"
                strokeOpacity="0.14"
                strokeWidth="2"
              />
            </pattern>
          </defs>

          {ticks.map((tick) => (
            <g key={`tick-${tick}`}>
              <line
                x1={PAD_L}
                y1={y(tick).toFixed(2)}
                x2={PAD_L + innerW}
                y2={y(tick).toFixed(2)}
                stroke="var(--color-line)"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 8}
                y={(y(tick) + 3).toFixed(2)}
                textAnchor="end"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--color-mute)"
              >
                {formatMoneyAxis(tick, active.currency)}
              </text>
            </g>
          ))}

          {gaps.map((gap) => {
            const from = dateIndex.get(gap.from);
            const to = dateIndex.get(gap.to);
            if (from === undefined || to === undefined) return null;
            const x0 = (x(from) - step / 2).toFixed(2);
            const w = (x(to) - x(from) + step).toFixed(2);
            const owned = gap.incidentId !== null;
            return (
              <g key={`${gap.from}-${gap.to}`}>
                {/* No border: the hatch alone says absence, and a dashed
                    outline turned the span into a warning box. */}
                <rect
                  x={x0}
                  y={PAD_T}
                  width={w}
                  height={innerH}
                  fill={`url(#${hatchId}-${owned ? "broken" : "absent"})`}
                />
                <text
                  x={(x(from) + (x(to) - x(from)) / 2).toFixed(2)}
                  y={PAD_T + 12}
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fill={owned ? "var(--color-broken)" : "var(--color-mute)"}
                >
                  {gap.incidentId ?? "no data"}
                </text>
              </g>
            );
          })}

          {/* One invisible band per day is the crosshair's hit surface -- a
            pointer-math loop would re-derive what these rects already know.
            Under the lines, not over them: a store line's own fat hit target
            must win where the pointer is actually on it, and a band that has
            fired enter keeps its day until the pointer finds another band. */}
          {points.map((point, i) => (
            <rect
              key={`hit-${point.date}`}
              x={(x(i) - (step || innerW) / 2).toFixed(2)}
              y={PAD_T}
              width={(step || innerW).toFixed(2)}
              height={innerH}
              fill="transparent"
              onPointerEnter={() => setHoveredDay(i)}
            />
          ))}

          {/* Store lines first, basket line last: subordination is drawing
            order and weight, not colour -- colour stays with the state
            machine. */}
          {drawnStores.map((store) => {
            const hot = hoveredStore === store.storeId;
            return (
              <g
                key={store.storeId}
                onPointerEnter={() => setHoveredStore(store.storeId)}
                onPointerLeave={() => setHoveredStore(null)}
              >
                {store.points.map((point, i) => {
                  const next = store.points[i + 1];
                  if (point.total === null || !next || next.total === null) return null;
                  const dim = isPartial(store, i) || isPartial(store, i + 1);
                  return (
                    <g key={`s-${store.storeId}-${point.date}`}>
                      <line
                        x1={x(i).toFixed(2)}
                        y1={y(point.total).toFixed(2)}
                        x2={x(i + 1).toFixed(2)}
                        y2={y(next.total).toFixed(2)}
                        stroke={hot ? "var(--color-ink)" : "var(--color-mute)"}
                        strokeOpacity={dim ? (hot ? 0.5 : 0.18) : hot ? 0.9 : 0.35}
                        strokeWidth={hot ? 1.5 : 1}
                      />
                      {/* The fat invisible twin is the hit target; r=11 worth of
                        reach on a 1px line, without lying about its weight. */}
                      <line
                        x1={x(i).toFixed(2)}
                        y1={y(point.total).toFixed(2)}
                        x2={x(i + 1).toFixed(2)}
                        y2={y(next.total).toFixed(2)}
                        stroke="transparent"
                        strokeWidth="10"
                      />
                    </g>
                  );
                })}
                {store.points.map((point, i) => {
                  if (point.total === null) return null;
                  return isPartial(store, i) ? (
                    /* Hollow: the day is real but the sum is short. */
                    <circle
                      key={`sp-${store.storeId}-${point.date}`}
                      cx={x(i).toFixed(2)}
                      cy={y(point.total).toFixed(2)}
                      r="2.5"
                      fill="var(--color-paper)"
                      stroke={hot ? "var(--color-ink)" : "var(--color-mute)"}
                      strokeOpacity={hot ? 0.9 : 0.5}
                      strokeWidth="1"
                    >
                      <title>{`${store.storeName} — ${formatDay(point.date)} — ${formatMoney(point.total, active.currency)} for ${point.pricedItems} of ${point.expectedItems}`}</title>
                    </circle>
                  ) : (
                    <circle
                      key={`sp-${store.storeId}-${point.date}`}
                      cx={x(i).toFixed(2)}
                      cy={y(point.total).toFixed(2)}
                      r="2"
                      fill={hot ? "var(--color-ink)" : "var(--color-mute)"}
                      fillOpacity={hot ? 0.9 : 0.35}
                    >
                      <title>{`${store.storeName} — ${formatDay(point.date)} — ${formatMoney(point.total, active.currency)}`}</title>
                    </circle>
                  );
                })}
              </g>
            );
          })}

          {labels.map((label) => (
            <text
              key={`label-${label.storeId ?? "basket"}`}
              x={PAD_L + innerW + 8}
              y={label.y.toFixed(2)}
              fontSize={label.storeId === null ? "10" : "9"}
              fontFamily="var(--font-mono)"
              fill={
                label.storeId === null || hoveredStore === label.storeId
                  ? "var(--color-ink)"
                  : "var(--color-mute)"
              }
              className="cursor-default"
              onPointerEnter={label.storeId ? () => setHoveredStore(label.storeId) : undefined}
              onPointerLeave={label.storeId ? () => setHoveredStore(null) : undefined}
            >
              {label.text}
            </text>
          ))}

          {/* The whole point. A break in the data is a break in the line: only
            adjacent readings are joined. */}
          {points.map((point, i) => {
            const next = points[i + 1];
            if (point.total === null || !next || next.total === null) return null;
            return (
              <line
                key={`seg-${point.date}`}
                x1={x(i).toFixed(2)}
                y1={y(point.total).toFixed(2)}
                x2={x(i + 1).toFixed(2)}
                y2={y(next.total).toFixed(2)}
                stroke="var(--color-ink)"
                strokeWidth="2"
              />
            );
          })}

          {points.map((point, i) => {
            if (point.total === null) return null;
            const tag = marked.get(i);
            return (
              <g key={`pt-${point.date}`}>
                {point.healed ? (
                  <>
                    <circle
                      cx={x(i).toFixed(2)}
                      cy={y(point.total).toFixed(2)}
                      r="6"
                      fill="var(--color-paper)"
                      stroke="var(--color-live)"
                      strokeWidth="1.5"
                    />
                    <text
                      x={x(i).toFixed(2)}
                      y={(y(point.total) - 12).toFixed(2)}
                      textAnchor="middle"
                      fontSize="9"
                      fontFamily="var(--font-mono)"
                      fill="var(--color-live)"
                    >
                      healed
                    </text>
                  </>
                ) : null}
                <circle
                  cx={x(i).toFixed(2)}
                  cy={y(point.total).toFixed(2)}
                  r={hoveredDay === i ? 4 : 3}
                  fill="var(--color-ink)"
                >
                  <title>{`${formatDay(point.date)} — ${formatMoney(point.total, active.currency)}`}</title>
                </circle>
                {tag ? (
                  <text
                    x={x(i).toFixed(2)}
                    y={(y(point.total) - (point.healed ? 24 : 10)).toFixed(2)}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fill="var(--color-mute)"
                  >
                    {`${formatMoney(point.total, active.currency)} · ${tag}`}
                  </text>
                ) : null}
              </g>
            );
          })}

          {hoveredDay !== null ? (
            <line
              x1={x(hoveredDay).toFixed(2)}
              y1={PAD_T}
              x2={x(hoveredDay).toFixed(2)}
              y2={PAD_T + innerH}
              stroke="var(--color-ink)"
              strokeOpacity="0.25"
              strokeWidth="1"
            />
          ) : null}

          {points.map((point, i) =>
            i % stride === 0 || i === points.length - 1 ? (
              <text
                key={`day-${point.date}`}
                x={x(i).toFixed(2)}
                y={H - 10}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--color-mute)"
              >
                {formatDay(point.date)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* Fixed height so hovering never shifts anything; the rest state is
          the legend, said in words instead of drawn in a box. */}
      <p aria-live="polite" className="mt-2 min-h-[32px] font-mono text-[10.5px] text-mute">
        {hoveredPoint ? (
          hoveredPoint.total !== null ? (
            <>
              <span className="text-ink">{formatDay(hoveredPoint.date)}</span>
              {" · "}
              <span className="text-ink">{formatMoney(hoveredPoint.total, active.currency)}</span>
              {` · ${hoveredPoint.pricedItems} of ${hoveredPoint.expectedItems} priced`}
              {hoveredPoint.healed ? " · a heal closed the gap here" : ""}
              {hotSeries && hoveredDay !== null
                ? storeReadout(hotSeries, hoveredDay, active.currency)
                : ""}
            </>
          ) : (
            <>
              <span className="text-ink">{formatDay(hoveredPoint.date)}</span>
              {" · no full basket"}
              {hoveredPoint.incidentId
                ? ` · incident ${hoveredPoint.incidentId}`
                : " · no incident recorded"}
            </>
          )
        ) : hotSeries ? (
          storeRestReadout(hotSeries, active.currency)
        ) : (
          "Hatched span: days we could not price every staple. Ringed dot: the day a heal closed the gap. Thin lines: each store's own sum over what it priced -- a hollow point is a partial day."
        )}
      </p>

      {/* The keyboard's crosshair: the same days, as real buttons. */}
      <ul className="sr-only">
        {points.map((point, i) => (
          <li key={`sr-${point.date}`}>
            <button
              type="button"
              onFocus={() => setHoveredDay(i)}
              onBlur={() => setHoveredDay(null)}
            >
              {point.total !== null
                ? `${formatDay(point.date)}: ${formatMoney(point.total, active.currency)}, ${point.pricedItems} of ${point.expectedItems} staples priced${point.healed ? ", heal closed the gap" : ""}`
                : `${formatDay(point.date)}: no full basket${point.incidentId ? `, incident ${point.incidentId}` : ""}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function isPartial(store: StoreSeries, index: number): boolean {
  const point = store.points[index];
  return point !== undefined && point.total !== null && point.pricedItems < point.expectedItems;
}

/** The hovered store's own figure for the hovered day, as a readout clause. */
function storeReadout(store: StoreSeries, day: number, currency: string): string {
  const point = store.points[day];
  if (!point || point.total === null) return ` · ${store.storeName}: nothing priced`;
  const partial =
    point.pricedItems < point.expectedItems
      ? `, ${point.pricedItems} of ${point.expectedItems} priced`
      : "";
  return ` · ${store.storeName}: ${formatMoney(point.total, currency)}${partial}`;
}

/** A store hovered with no day pinned: its latest own sum, dated. */
function storeRestReadout(store: StoreSeries, currency: string): string {
  const latest = store.points.findLast((p) => p.total !== null);
  if (!latest || latest.total === null) return `${store.storeName}: no priced days yet`;
  return `${store.storeName}: ${formatMoney(latest.total, currency)} on ${formatDay(latest.date)}, its own sum over what it priced`;
}

/* Past this multiple of the basket's own total, a store leaves the chart and
   is named beneath it instead -- the same spirit as the dot-plot's ratio cap. */
const CHART_CAP = 4;

/** The store's worst multiple of the basket total across shared days. */
function storeRatio(store: StoreSeries, points: BasketSeries["points"]): number {
  let worst = 0;
  points.forEach((point, i) => {
    const own = store.points[i];
    if (point.total === null || point.total === 0 || !own || own.total === null) return;
    worst = Math.max(worst, own.total / point.total);
  });
  return worst;
}

type EndLabel = { storeId: string | null; text: string; y: number };

/**
 * Direct labels at each line's right end -- the basket's own included, with
 * its latest figure riding along -- nudged apart top to bottom. Two lines
 * that finish a few cents apart would otherwise print their names on top of
 * each other, and a smeared label is worse than a moved one.
 */
function placeLabels(
  active: BasketSeries,
  stores: StoreSeries[],
  y: (v: number) => number,
): EndLabel[] {
  const placed: EndLabel[] = [];
  for (const store of stores) {
    const latest = store.points.findLast((p) => p.total !== null);
    if (!latest || latest.total === null) continue;
    const text = store.storeName.length > 14 ? `${store.storeName.slice(0, 13)}…` : store.storeName;
    placed.push({ storeId: store.storeId, text, y: y(latest.total) + 3 });
  }

  const basketLatest = active.points.findLast((p) => p.total !== null);
  if (basketLatest && basketLatest.total !== null) {
    placed.push({
      storeId: null,
      text: `the basket ${formatMoney(basketLatest.total, active.currency)}`,
      y: y(basketLatest.total) + 3,
    });
  }

  placed.sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i++) {
    const previous = placed[i - 1];
    const current = placed[i];
    if (previous && current && current.y < previous.y + 11) current.y = previous.y + 11;
  }
  return placed;
}

/** Round tick positions on a 1-2-5 ladder; a ruler nobody has to squint at. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  if (hi <= lo) return [];
  const rough = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 5, 10].map((m) => m * power);
  const step = candidates.find((c) => c >= rough) ?? candidates[3] ?? rough;
  const ticks: number[] = [];
  for (let tick = Math.ceil(lo / step) * step; tick <= hi; tick += step) ticks.push(tick);
  return ticks;
}

/** Contiguous runs of null totals, with the incident that explains them. */
function findGaps(series: BasketSeries | undefined) {
  if (!series) return [];
  const gaps: { from: string; to: string; incidentId: string | null }[] = [];
  let start: number | null = null;

  series.points.forEach((point, index) => {
    const missing = point.total === null;
    if (missing && start === null) start = index;
    if ((!missing || index === series.points.length - 1) && start !== null) {
      const end = missing ? index : index - 1;
      // Exactly the missing dates. Extending the band to the neighbouring good
      // points would hatch over real observations and imply they are missing too.
      const from = series.points[start]?.date;
      const to = series.points[end]?.date;
      if (from && to) {
        gaps.push({ from, to, incidentId: series.points[start]?.incidentId ?? null });
      }
      start = null;
    }
  });

  return gaps;
}
