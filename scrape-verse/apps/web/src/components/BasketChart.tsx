import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { basketSeries } from "../data/mock";

/**
 * The hero chart: basket total over time. A broken scraper shows up as a
 * literal gap in the line (connectNulls is intentionally off); the heal
 * marker shows where the engine closed it.
 */
export function BasketChart() {
  const healedPoint = basketSeries.find((p) => p.healed);
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={basketSeries} margin={{ top: 8, right: 16, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="#262c37" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#8d97a5" fontSize={12} tickLine={false} />
          <YAxis
            stroke="#8d97a5"
            fontSize={12}
            tickLine={false}
            domain={["dataMin - 0.5", "dataMax + 0.5"]}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            contentStyle={{ background: "#171b22", border: "1px solid #262c37", borderRadius: 8 }}
            labelStyle={{ color: "#8d97a5" }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, "basket total"]}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="#e05648"
            strokeWidth={2}
            dot={{ r: 3, fill: "#e05648" }}
            connectNulls={false}
            isAnimationActive={false}
          />
          {healedPoint && healedPoint.total !== null && (
            <ReferenceDot
              x={healedPoint.date}
              y={healedPoint.total}
              r={7}
              fill="none"
              stroke="#5bbf8a"
              strokeWidth={2}
              label={{ value: "healed", position: "top", fill: "#5bbf8a", fontSize: 11 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
