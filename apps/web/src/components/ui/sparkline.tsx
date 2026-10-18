/**
 * A product's recent price steps as a step line: history is change-only, so a
 * price holds flat until the next step, and the last step holds until today.
 * One point draws a flat line. Purely decorative next to the printed price,
 * so it carries a label rather than a table.
 */
export function Sparkline({
  points,
  width = 96,
  height = 24,
  label,
}: {
  points: { d: string; p: number }[];
  width?: number;
  height?: number;
  label: string;
}) {
  if (points.length === 0) return null;
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const t0 = day(points[0]!.d);
  const t1 = Math.max(Date.now(), day(points.at(-1)!.d) + 86_400_000);
  const values = points.map((p) => p.p);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = 2;
  const x = (t: number) => pad + ((t - t0) / (t1 - t0 || 1)) * (width - pad * 2);
  const y = (v: number) =>
    hi > lo ? height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2) : height / 2;

  let path = `M${x(t0).toFixed(1)},${y(points[0]!.p).toFixed(1)}`;
  for (const pt of points.slice(1)) {
    path += ` H${x(day(pt.d)).toFixed(1)} V${y(pt.p).toFixed(1)}`;
  }
  path += ` H${x(t1).toFixed(1)}`;
  const last = points.at(-1)!;
  const falling = points.length > 1 && last.p < points.at(-2)!.p;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.25" className="text-mute" />
      <circle cx={x(t1)} cy={y(last.p)} r="2.25" className={falling ? "fill-live" : "fill-ink"} />
    </svg>
  );
}
