"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { formatBasis, formatMoney } from "@/lib/format";
import { findCell } from "@/lib/terrain/model";
import type { TerrainGrid } from "@/lib/terrain/model";
import { Ridgeline } from "@/components/terrain/ridgeline";
import { useSelection } from "@/components/terrain/selection";
import { cn } from "@/lib/utils";

/*
 * The 3D scene is client-only and lazy: it never renders on the server, and
 * three.js never enters the initial route bundle. The ridgeline below draws
 * the same grid, so it stands in until the scene is live, stands permanently
 * when WebGL is unavailable, and stays mounted (visually hidden) for keyboard
 * and screen-reader access either way.
 */
const TerrainScene = dynamic(() => import("./terrain-scene"), {
  ssr: false,
  loading: () => null,
});

/**
 * The hero: the landscape full-bleed with the headline set on it, the way a
 * map plate carries its title. The landscape is navigation, not decoration:
 * hovering reads a cell out in words along the bottom edge, clicking jumps
 * to the staple's section. The readout has a fixed height so hovering never
 * shifts anything.
 */
export function TerrainHero({
  grid,
  overlay,
}: {
  grid: TerrainGrid | null;
  overlay?: ReactNode;
}) {
  const { hovered, selected, setHovered, select, clear } = useSelection();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [sceneLive, setSceneLive] = useState(false);

  useEffect(() => {
    // ?flat=1 is the honest test hook for the fallback path.
    if (new URLSearchParams(window.location.search).get("flat") === "1") {
      setWebgl(false);
      return;
    }
    const probe = document.createElement("canvas");
    setWebgl(Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl")));
  }, []);

  const showScene = webgl === true;
  // A live hover outranks the pin; the pin keeps the readout when the pointer
  // leaves, which is what makes a click feel like it held something.
  const shown = hovered ?? selected;
  const cell = grid && shown ? findCell(grid, shown) : null;

  return (
    /* The warm-to-paper wash behind the transparent canvas is the sky: the
       far rows haze toward paper in the vertex colors and land on the same
       tone here, so the massif dissolves into air instead of ending. */
    <div className="relative h-full w-full bg-[linear-gradient(to_bottom,#f3eee1,var(--color-paper)_62%)]">
      {grid && showScene ? (
        /* The scene fades over the ridgeline once its first frame is up,
           so the hand-off reads as intentional rather than as a pop. */
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-500",
            sceneLive ? "opacity-100" : "opacity-0",
          )}
        >
          <TerrainScene
            grid={grid}
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
        <div
          className={cn(
            showScene && sceneLive
              ? "sr-only"
              : /* The fallback shares the frame with the headline, so it sits
                   below it rather than centered behind it. The figure needs
                   its width stated: as a shrink-to-fit flex item it would
                   collapse around the svg's minimum. */
                "flex h-full w-full items-end justify-center px-5 pb-16 pt-32 [&_figure]:w-full [&_figure]:max-w-[980px] [&_svg]:max-h-[52svh]",
          )}
        >
          <Ridgeline grid={grid} />
        </div>
      ) : (
        <p className="absolute bottom-16 left-5 font-mono text-[12px] text-mute sm:left-8">
          Not enough comparable prices to draw a landscape here yet.
        </p>
      )}

      {/* The headline rides on the scene. pointer-events-none end to end:
          nothing in it is a control, and the terrain hover must pass through. */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 max-w-[640px] px-5 pt-8 sm:px-8 sm:pt-12">
        {overlay}
      </div>

      {/* The readout, pinned to the scene's bottom edge as a paper chip.
          Anchored by its bottom so a wrapped line grows upward into the
          scene instead of shifting anything. */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex min-h-[46px] items-end px-5 pb-4 sm:px-8"
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
