"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { formatBasis, formatMoney } from "@/lib/format";
import { findCell } from "@/lib/terrain/model";
import type { TerrainGrid } from "@/lib/terrain/model";
import { Ridgeline } from "@/components/terrain/ridgeline";
import { useSelection } from "@/components/terrain/selection";
import { PlateWatermark } from "@/components/plates/staple-plate";
import { cn } from "@/lib/utils";

/*
 * The 3D scene is client-only and lazy: it never renders on the server, and
 * three.js never enters the initial route bundle. The ridgeline below draws
 * the same grid, and is drawn only where the scene cannot be: when WebGL is
 * unavailable it is the hero. Everywhere else it stays mounted but visually
 * hidden, carrying the landscape for keyboard and screen-reader access.
 */
const TerrainScene = dynamic(() => import("./terrain-scene"), {
  ssr: false,
  loading: () => null,
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** ?weather=clear|overcast|0..1 -- the demo hook beside ?flat=1. */
function parseWeatherOverride(raw: string | null): number | null {
  if (raw === null) return null;
  if (raw === "clear") return 0;
  if (raw === "overcast") return 1;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? clamp01(n) : null;
}

/**
 * The hero: the landscape full-bleed with the headline set on it, the way a
 * map plate carries its title. The landscape is navigation, not decoration:
 * hovering reads a cell out in words along the bottom edge, clicking jumps
 * to the staple's section. The readout has a fixed height so hovering never
 * shifts anything.
 *
 * Stacking, bottom to top: the sky gradient on the container, the staple
 * etching watermark (z-0), the headline (z-[1]), the scene (z-[2]) -- so the
 * far summits graze the headline's descenders and drift over the etching --
 * and the readout chip (z-20). Nothing stands in for the scene while it
 * loads: the sky and the headline are the whole hero until it fades up.
 */
export function TerrainHero({
  grid,
  weather,
  overlay,
}: {
  grid: TerrainGrid | null;
  /* 0 clear .. 1 overcast, from the rails' own gaps */
  weather: number;
  overlay?: ReactNode;
}) {
  const { hovered, selected, setHovered, select, clear } = useSelection();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [sceneLive, setSceneLive] = useState(false);
  const [weatherOverride, setWeatherOverride] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setWeatherOverride(parseWeatherOverride(params.get("weather")));
    // ?flat=1 is the honest test hook for the fallback path.
    if (params.get("flat") === "1") {
      setWebgl(false);
      return;
    }
    const probe = document.createElement("canvas");
    setWebgl(Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl")));
  }, []);

  const showScene = webgl === true;
  const w = weatherOverride ?? clamp01(weather);
  // A live hover outranks the pin; the pin keeps the readout when the pointer
  // leaves, which is what makes a click feel like it held something.
  const shown = hovered ?? selected;
  const cell = grid && shown ? findCell(grid, shown) : null;

  // The fallback layout: the figure needs its width stated, since as a
  // shrink-to-fit flex item it would collapse around the svg's minimum.
  const ridgeLayout =
    "flex h-full w-full items-end justify-center px-5 pb-16 pt-32 [&_figure]:w-full [&_figure]:max-w-[980px] [&_svg]:max-h-[52svh]";

  return (
    /* The warm-to-paper wash behind the transparent canvas is the sky: the
       far rows haze toward paper in the vertex colors and land on the same
       tone here, so the massif dissolves into air instead of ending. Clear
       weather warms the top of the sky; overcast drifts it grey. */
    <div
      className="relative h-full w-full"
      style={{
        backgroundImage: `linear-gradient(to bottom, color-mix(in oklab, #f6ecd9 ${Math.round(
          100 - 55 * w,
        )}%, #e7e4dd), var(--color-paper) 62%)`,
      }}
    >
      {/* The staple plate, faint as a watermark in the paper. Behind even the
          headline: the massif and the title both ride over it. Scaled past the
          frame and clipped by its own wrapper rather than by the hero, so the
          canvas and the ridgeline keep the layout they were built with. */}
      {grid ? (
        <div className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden lg:block">
          <div className="absolute -right-[14%] -top-[30%] h-[150%] w-[62%] opacity-[0.08]">
            <PlateWatermark staples={grid.staples} activeKey={shown?.itemKey ?? null} />
          </div>
        </div>
      ) : null}

      {/* The headline rides under the scene: far summits clip its descenders
          the way a range crosses a map title. pointer-events-none end to end:
          nothing in it is a control, and the terrain hover must pass through. */}
      <div className="pointer-events-none absolute left-0 top-0 z-[1] max-w-[640px] px-5 pt-8 sm:px-8 sm:pt-12">
        {overlay}
      </div>

      {grid && showScene ? (
        /* The scene fades up out of the sky once its first frame is ready,
           so it arrives rather than pops. */
        <div
          className={cn(
            "absolute inset-0 z-[2] transition-opacity duration-500",
            sceneLive ? "opacity-100" : "opacity-0",
          )}
        >
          <TerrainScene
            grid={grid}
            weather={w}
            hovered={hovered}
            selected={selected}
            onHover={setHovered}
            onSelect={select}
            onClear={clear}
            onReady={() => setSceneLive(true)}
          />
        </div>
      ) : null}
      {grid ? (
        /* Drawn only where the scene cannot be. `webgl` is null for the tick
           before the probe answers, and a chart that appears for that tick and
           then leaves reads as a placeholder that failed to clear -- so the
           layout is spent on a settled `false`, and nothing else. Mounted
           either way: the sr-only cell buttons inside are the landscape's
           keyboard and screen-reader surface. */
        <div className={webgl === false ? ridgeLayout : "sr-only"}>
          <Ridgeline grid={grid} weather={w} />
        </div>
      ) : (
        <p className="absolute bottom-16 left-5 font-mono text-[12px] text-mute sm:left-8">
          Not enough comparable prices to draw a landscape here yet.
        </p>
      )}

      {/* The readout, pinned to the scene's bottom edge as a paper chip.
          Anchored by its bottom so a wrapped line grows upward into the
          scene instead of shifting anything. */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex min-h-[46px] items-end px-5 pb-4 sm:px-8"
      >
        <p className="border border-line bg-paper/85 px-2.5 py-1.5 text-[12.5px] backdrop-blur-[2px]">
          {cell ? (
            <>
              <span className="font-medium">{cell.storeName}</span>
              <span className="text-mute"> · </span>
              {cell.label}
              <span className="text-mute"> · </span>
              <span className="font-mono text-[12px]">
                {formatMoney(cell.unitPrice.amount, cell.unitPrice.currency)}
              </span>{" "}
              <span className="font-mono text-[10.5px] text-mute">
                {formatBasis(cell.unitPriceBasis)}
              </span>
              <span className="text-mute"> · </span>
              <span className={cell.cheapest ? "text-live" : "text-mute"}>
                {cell.cheapest ? "the cheapest shelf" : `${cell.ratio.toFixed(1)}x the cheapest`}
              </span>
            </>
          ) : (
            <span className="text-mute">
              Height is how many times the cheapest store prices that staple. Hover to read a
              price; click to open the staple below.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
