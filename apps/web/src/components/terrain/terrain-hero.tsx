"use client";

import { useEffect, useState } from "react";
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
 * The hero and its readout. The landscape is navigation, not decoration:
 * hovering reads a cell out in words underneath, clicking jumps to the
 * staple's section. The readout line has a fixed height so hovering never
 * shifts the page.
 */
export function TerrainHero({ grid }: { grid: TerrainGrid | null }) {
  const { hovered, setHovered, select } = useSelection();
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

  if (!grid) {
    return (
      <p className="py-10 font-mono text-[12px] text-mute">
        Not enough comparable prices to draw a landscape here yet.
      </p>
    );
  }

  const showScene = webgl === true;
  const cell = hovered ? findCell(grid, hovered) : null;

  return (
    <div>
      <div className="relative h-[56vh] min-h-[440px] w-full">
        {showScene ? (
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
              onHover={setHovered}
              onSelect={select}
              onReady={() => setSceneLive(true)}
            />
          </div>
        ) : null}
        <div
          className={cn(
            showScene && sceneLive
              ? "sr-only"
              : "flex h-full w-full items-center justify-center [&_svg]:max-h-full",
          )}
        >
          <Ridgeline grid={grid} />
        </div>
      </div>

      <p aria-live="polite" className="mt-7 min-h-[22px] text-[12.5px]">
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
  );
}
