"use client";

import { useMemo, useState } from "react";
import type { BasketSeries } from "@basketwatch/contract";
import { formatDay, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const W = 640;
const H = 150;
const PAD_L = 52;
const PAD_R = 52;
const PAD_T = 18;
const PAD_B = 30;

/**
 * The basket over time, drawn by hand instead of by a charting library --
 * with a handful of readings, a chart library renders an axis system for
 * three dots.
 *
 * Every price chart on the internet draws a smooth line, and a smooth line
 * lies: it interpolates across the days a scraper was broken. This one stops.
 * The missing span is hatched in the broken colour and labelled with the
 * incident that caused it, and the line resumes where the heal closed the gap.
 */
export function IndexStrip({ series }: { series: BasketSeries[] }) {
  const [activeCountry, setActiveCountry] = useState(series[0]?.country ?? "US");
  const active = series.find((s) => s.country === activeCountry) ?? series[0];

  const gaps = useMemo(() => findGaps(active), [active]);

  if (!active) return null;

  const points = active.points;
  const totals = points.map((p) => p.total).filter((t): t is number => t !== null);
  const readings = totals.length;
  const lo = Math.min(...totals) * 0.9;
  const hi = Math.max(...totals) * 1.1;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? PAD_L + i * step : W / 2);
  const y = (v: number) => (hi > lo ? PAD_T + (1 - (v - lo) / (hi - lo)) * innerH : H / 2);
  const dateIndex = new Map(points.map((p, i) => [p.date, i]));

  return (
    <div className="flex h-full flex-col">
      {series.length > 1 ? (
        <div className="mb-3 flex gap-5" role="tablist" aria-label="Country">
          {series.map((s) => (
            <button
              key={s.country}
              type="button"
              role="tab"
              aria-selected={s.country === activeCountry}
              onClick={() => setActiveCountry(s.country)}
              className={cn(
                "caps pb-1 transition-colors",
                s.country === activeCountry
                  ? "border-b border-ink text-ink"
                  : "border-b border-transparent hover:text-ink",
              )}
            >
              {s.country} · {s.currency}
            </button>
          ))}
        </div>
      ) : null}

      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Basket total by day">
        <defs>
          {/* The scar. Hatching rather than a fill, so a gap reads as absence
              instead of as a value of zero. */}
          <pattern
            id="scar-hatch"
            width="8"
            height="8"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="8" height="8" fill="var(--color-broken)" fillOpacity="0.05" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="8"
              stroke="var(--color-broken)"
              strokeOpacity="0.3"
              strokeWidth="2"
            />
          </pattern>
        </defs>

        {gaps.map((gap) => {
          const from = dateIndex.get(gap.from);
          const to = dateIndex.get(gap.to);
          if (from === undefined || to === undefined) return null;
          const x0 = (x(from) - step / 2).toFixed(2);
          const w = (x(to) - x(from) + step).toFixed(2);
          return (
            <g key={`${gap.from}-${gap.to}`}>
              <rect
                x={x0}
                y={PAD_T}
                width={w}
                height={innerH}
                fill="url(#scar-hatch)"
                stroke="var(--color-broken)"
                strokeOpacity="0.25"
                strokeDasharray="3 3"
              />
              <text
                x={(x(from) + (x(to) - x(from)) / 2).toFixed(2)}
                y={PAD_T + 10}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--font-mono)"
                fill="var(--color-broken)"
              >
                {gap.incidentId ?? "no data"}
              </text>
            </g>
          );
        })}

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
              strokeWidth="1.5"
            />
          );
        })}

        {points.map((point, i) => {
          if (point.total === null) return null;
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
                    y={(y(point.total) - 10).toFixed(2)}
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
                r="3"
                fill="var(--color-ink)"
              >
                <title>{`${formatDay(point.date)} — ${formatMoney(point.total, active.currency)}`}</title>
              </circle>
              <text
                x={x(i).toFixed(2)}
                y={(y(point.total) - (point.healed ? 22 : 8)).toFixed(2)}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--color-mute)"
              >
                {formatMoney(point.total, active.currency)}
              </text>
            </g>
          );
        })}

        {points.map((point, i) => (
          <text
            key={`day-${point.date}`}
            x={x(i).toFixed(2)}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--color-mute)"
          >
            {formatDay(point.date)}
          </text>
        ))}
      </svg>

      {/*
       * The honest caption for a chart with one reading on it. Drawing a wide
       * empty axis and leaving the reader to infer why implies missing history;
       * saying when tracking began implies nothing, because it is the fact.
       */}
      <p className="mt-2 font-mono text-[10.5px] text-mute">
        {readings <= 1
          ? `Tracking began ${formatDay(points[0]?.date ?? "")}. One reading so far; the line starts at two.`
          : `${readings} readings since ${formatDay(points[0]?.date ?? "")}. A break in the line is a day we could not price the whole basket.`}
      </p>
    </div>
  );
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
