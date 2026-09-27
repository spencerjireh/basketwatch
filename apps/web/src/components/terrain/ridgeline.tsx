"use client";

import { Fragment } from "react";
import { formatBasis, formatMoney } from "@/lib/format";
import { GAP_READING } from "@/lib/terrain/model";
import type { TerrainGrid } from "@/lib/terrain/model";
import { useSelection } from "@/components/terrain/selection";

const LABEL_W = 170;
const ROW_H = 42;
const RIDGE_H = 68;
const PAD_RIGHT = 24;
const PAD_BOTTOM = 16;
/**
 * Headroom for the store axis. The names are set at an angle, so the band has
 * to clear the rise of the longest one rather than its cap height: about 16
 * characters of 10px mono, laid over at 35 degrees.
 */
const AXIS_H = 70;
/**
 * Positive, because SVG's y runs down. With `textAnchor="end"` the glyphs lie
 * to the left of the anchor, so a positive angle carries them up-and-left into
 * the band above; the negative angle of a d3 bottom axis would send the same
 * run down-and-left, through the first row of ridges.
 */
const AXIS_TILT = 35;

/** Long chains do not fit a 52px column, and the full name is on the title. */
const shortStore = (name: string) => (name.length > 17 ? `${name.slice(0, 16)}\u2026` : name);

/**
 * The landscape, flat. One ridge per staple, one x-step per store, height =
 * times the cheapest. A missing pin breaks the ridge: a gap is drawn as
 * absence, never as sea level.
 *
 * This component is three things at once -- the loading placeholder for the 3D
 * scene, the permanent hero when WebGL is unavailable, and the shipped hero if
 * the 3D is cut -- which is why it carries the full hover/click wiring itself.
 */
export function Ridgeline({ grid, weather = 0 }: { grid: TerrainGrid; weather?: number }) {
  const { hovered, hoveredStore, setHovered, setHoveredStore, select } = useSelection();

  // Weather parity with the 3D relief: overcast thins the clay wash. The
  // dots and labels stay full ink -- the data does not fade, the light does.
  const ridgeFill = 0.75 * (1 - 0.3 * weather);
  const ridgeStroke = 0.5 * (1 - 0.25 * weather);

  // Fewer stores get wider steps, so a five-store country still draws a
  // landscape rather than a sliver.
  const colW = Math.max(52, Math.min(96, Math.round(560 / Math.max(1, grid.stores.length - 1))));
  const width = LABEL_W + (grid.stores.length - 1) * colW + PAD_RIGHT;
  const height = AXIS_H + RIDGE_H + 10 + (grid.staples.length - 1) * ROW_H + PAD_BOTTOM;
  const x = (col: number) => LABEL_W + col * colW;
  const base = (row: number) => AXIS_H + RIDGE_H + 10 + row * ROW_H;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Price landscape for ${grid.country}: ${grid.staples.length} staples across ${grid.stores.length} stores, drawn as ridges where height is the multiple of the cheapest price.`}
      >
        {/* The store axis. The relief names one store and only under the
            pointer; here every name is standing, because this is the view a
            reader picks when they want the labels. */}
        {grid.stores.map((store, col) => {
          const lit = hoveredStore === store.storeId || hovered?.storeId === store.storeId;
          return (
            <text
              key={store.storeId}
              x={x(col)}
              y={AXIS_H - 8}
              transform={`rotate(${AXIS_TILT} ${x(col)} ${AXIS_H - 8})`}
              textAnchor="end"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fill={lit ? "var(--color-ink)" : "var(--color-mute)"}
              className="cursor-default"
              onMouseEnter={() => setHoveredStore(store.storeId)}
              onMouseLeave={() => setHoveredStore(null)}
            >
              <title>{store.storeName}</title>
              {shortStore(store.storeName)}
            </text>
          );
        })}

        {grid.staples.map((staple, row) => {
          const cells = grid.cells[row] ?? [];
          const y0 = base(row);

          // Contiguous runs of priced cells; each run is its own closed area,
          // so the tear between runs stays visible.
          const runs: number[][] = [];
          let run: number[] = [];
          cells.forEach((cell, col) => {
            if (cell) {
              run.push(col);
            } else if (run.length > 0) {
              runs.push(run);
              run = [];
            }
          });
          if (run.length > 0) runs.push(run);

          return (
            <Fragment key={staple.itemKey}>
              <line
                x1={LABEL_W - 8}
                y1={y0}
                x2={width - PAD_RIGHT + 12}
                y2={y0}
                stroke="var(--color-line)"
                strokeWidth="1"
              />
              <text
                x="0"
                y={y0}
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--color-mute)"
                letterSpacing="0.08em"
              >
                {staple.label.toUpperCase()}
              </text>

              {runs.map((cols) => {
                const first = cols[0] as number;
                const last = cols[cols.length - 1] as number;
                if (cols.length === 1) return null; // a lone reading is just its dot
                const top = cols
                  .map((col) => {
                    const cell = cells[col];
                    const y = (y0 - (cell?.height ?? 0) * RIDGE_H).toFixed(2);
                    return `L ${x(col).toFixed(2)} ${y}`;
                  })
                  .join(" ");
                const d = `M ${x(first).toFixed(2)} ${y0.toFixed(2)} ${top} L ${x(last).toFixed(2)} ${y0.toFixed(2)} Z`;
                return (
                  <path
                    key={`${staple.itemKey}:${first}`}
                    d={d}
                    fill="var(--color-clay)"
                    fillOpacity={ridgeFill.toFixed(3)}
                    stroke="var(--color-ink)"
                    strokeOpacity={ridgeStroke.toFixed(3)}
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />
                );
              })}

              {cells.map((cell, col) => {
                if (!cell) {
                  // A gap is pointable, and still drawn as absence. The target
                  // sits on the row's own rule, which is where the eye already
                  // goes to find a missing point -- the break in the line. It
                  // cannot steal a priced dot: two of these would have to be
                  // within 22px, and a column is never narrower than 52.
                  const store = grid.stores[col];
                  if (!store) return null;
                  const ref = {
                    country: grid.country,
                    itemKey: staple.itemKey,
                    storeId: store.storeId,
                  };
                  return (
                    <circle
                      key={`gap:${store.storeId}`}
                      cx={x(col).toFixed(2)}
                      cy={y0.toFixed(2)}
                      r="11"
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHovered(ref)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => select(ref)}
                    />
                  );
                }
                const cy = (y0 - cell.height * RIDGE_H).toFixed(2);
                const isHovered =
                  hovered?.itemKey === cell.itemKey && hovered?.storeId === cell.storeId;
                return (
                  <Fragment key={cell.storeId}>
                    {cell.cheapest || cell.flag === "imprecise" || isHovered ? (
                      <circle
                        cx={x(col).toFixed(2)}
                        cy={cy}
                        r={isHovered ? "3.5" : "2.5"}
                        fill={
                          isHovered
                            ? "var(--color-ink)"
                            : cell.cheapest
                              ? "var(--color-live)"
                              : "var(--color-drift)"
                        }
                      />
                    ) : null}
                    <circle
                      cx={x(col).toFixed(2)}
                      cy={cy}
                      r="11"
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() =>
                        setHovered({
                          country: grid.country,
                          itemKey: cell.itemKey,
                          storeId: cell.storeId,
                        })
                      }
                      onMouseLeave={() => setHovered(null)}
                      onClick={() =>
                        select({
                          country: grid.country,
                          itemKey: cell.itemKey,
                          storeId: cell.storeId,
                        })
                      }
                    />
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </svg>

      {/* The same cells for keyboard and screen readers, as honest buttons.
          Walked by row and column rather than over a flattened list, because
          the gaps belong here too and a null carries no store or staple of its
          own -- the grid it sits in is the only thing that can name it. */}
      <ul className="sr-only">
        {grid.staples.map((staple, row) =>
          grid.stores.map((store, col) => {
            const cell = grid.cells[row]?.[col];
            const ref = {
              country: grid.country,
              itemKey: staple.itemKey,
              storeId: store.storeId,
            };
            return (
              <li key={`${staple.itemKey}:${store.storeId}`}>
                <button
                  type="button"
                  onFocus={() => setHovered(ref)}
                  onBlur={() => setHovered(null)}
                  onClick={() => select(ref)}
                >
                  {cell ? (
                    <>
                      {cell.storeName}, {cell.label}:{" "}
                      {formatMoney(cell.unitPrice.amount, cell.unitPrice.currency)}{" "}
                      {formatBasis(cell.unitPriceBasis)}, {cell.ratio.toFixed(1)} times the cheapest
                    </>
                  ) : (
                    <>
                      {store.storeName}, {staple.label}: {GAP_READING}
                    </>
                  )}
                </button>
              </li>
            );
          }),
        )}
      </ul>
    </figure>
  );
}
