"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BasketSeries } from "@basketwatch/contract";
import { formatDay, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The hero.
 *
 * Every price chart on the internet draws a smooth line, and a smooth line lies:
 * it interpolates across the days a scraper was broken. This one stops. The
 * missing span is hatched in the broken colour and labelled with the incident
 * that caused it, and the line resumes at a stitch mark where the heal closed
 * the gap.
 *
 * connectNulls stays false. That single prop is the product thesis.
 */
export function IndexChart({ series }: { series: BasketSeries[] }) {
  const [activeCountry, setActiveCountry] = useState(series[0]?.country ?? "US");
  const active = series.find((s) => s.country === activeCountry) ?? series[0];

  const gaps = useMemo(() => findGaps(active), [active]);
  const heals = useMemo(
    () => (active?.points ?? []).filter((point) => point.healed && point.total !== null),
    [active],
  );

  if (!active) return null;

  const money = (value: number) => formatMoney(value, active.currency);
  const readings = active.points.filter((point) => point.total !== null).length;

  return (
    <div className="flex h-full flex-col">
      {series.length > 1 ? (
        <div className="mb-3 flex gap-1" role="tablist" aria-label="Country">
          {series.map((s) => (
            <button
              key={s.country}
              type="button"
              role="tab"
              aria-selected={s.country === activeCountry}
              onClick={() => setActiveCountry(s.country)}
              className={cn(
                "rounded border px-2.5 py-1 font-mono text-[11px] transition-colors",
                s.country === activeCountry
                  ? "border-heal/40 bg-heal/10 text-heal"
                  : "border-line text-mute hover:text-chalk",
              )}
            >
              {s.country} · {s.currency}
            </button>
          ))}
        </div>
      ) : null}

      <div className="h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={active.points} margin={{ top: 12, right: 24, bottom: 4, left: 4 }}>
            <defs>
              {/* The scar. Hatching rather than a fill, so a gap reads as
                  absence instead of as a value of zero. */}
              <pattern
                id="scar-hatch"
                width="8"
                height="8"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="8" height="8" fill="var(--color-broken)" fillOpacity="0.07" />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="8"
                  stroke="var(--color-broken)"
                  strokeOpacity="0.4"
                  strokeWidth="2"
                />
              </pattern>
            </defs>

            <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />

            {gaps.map((gap) => (
              <ReferenceArea
                key={`${gap.from}-${gap.to}`}
                x1={gap.from}
                x2={gap.to}
                fill="url(#scar-hatch)"
                stroke="var(--color-broken)"
                strokeOpacity={0.25}
                strokeDasharray="3 3"
                label={{
                  value: gap.incidentId ?? "no data",
                  position: "insideTop",
                  fill: "var(--color-broken)",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                }}
              />
            ))}

            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              stroke="var(--color-mute)"
              tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
            />
            <YAxis
              tickFormatter={money}
              stroke="var(--color-mute)"
              tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={false}
              width={72}
              /*
               * Proportional, not a fixed half-unit. On a basket that totals
               * PHP 1,420 a +/- 0.5 window renders five gridlines a quarter of
               * a peso apart, which magnifies rounding into what looks like
               * volatility. Ten percent of the value keeps the scale honest at
               * either magnitude.
               */
              domain={[
                (min: number) => min * 0.9,
                (max: number) => max * 1.1,
              ]}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-board)",
                border: "1px solid var(--color-line)",
                borderRadius: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
              labelFormatter={(label) => (typeof label === "string" ? formatDay(label) : "")}
              formatter={(value) => [
                typeof value === "number" ? money(value) : "no trustworthy data",
                "basket",
              ]}
            />

            <Line
              type="monotone"
              dataKey="total"
              stroke="var(--color-heal)"
              strokeWidth={2}
              // Dots are not decoration here: with connectNulls={false} a reading
              // whose neighbours are both missing has no line segment to belong
              // to, and would render as nothing at all. Each dot is one
              // observation, which is also the honest way to draw this.
              dot={{ r: 2.5, fill: "var(--color-heal)", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "var(--color-heal)" }}
              // The whole point. A break in the data is a break in the line.
              connectNulls={false}
              isAnimationActive={false}
            />

            {heals.map((point) => (
              <ReferenceDot
                key={point.date}
                x={point.date}
                y={point.total ?? 0}
                r={6}
                fill="var(--color-board)"
                stroke="var(--color-live)"
                strokeWidth={2}
                label={{
                  value: "healed",
                  position: "top",
                  fill: "var(--color-live)",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/*
       * The honest caption for a chart with one reading on it. Drawing a wide
       * empty axis and leaving the reader to infer why implies missing history;
       * saying when tracking began implies nothing, because it is the fact.
       */}
      <p className="mt-2 font-mono text-[10.5px] text-mute">
        {readings <= 1
          ? `Tracking began ${formatDay(active.points[0]?.date ?? "")}. One reading so far; the line starts at two.`
          : `${readings} readings since ${formatDay(active.points[0]?.date ?? "")}. A break in the line is a day we could not price the whole basket.`}
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
