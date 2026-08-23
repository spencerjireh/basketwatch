"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { formatBasis, formatMoney } from "@/lib/format";
import { GAP_READING, findCell, findGap } from "@/lib/terrain/model";
import type { TerrainGrid } from "@/lib/terrain/model";
import { Ridgeline } from "@/components/terrain/ridgeline";
// Type-only, so the dynamic import below stays the only route three enters by.
import type { TerrainControls } from "@/components/terrain/terrain-scene";
import { useSelection } from "@/components/terrain/selection";
import { PlateWatermark } from "@/components/plates/staple-plate";
import { cn } from "@/lib/utils";

/*
 * The 3D scene is client-only and lazy: it never renders on the server, and
 * three.js never enters the initial route bundle. The ridgeline below draws
 * the same grid, and is laid out whenever the reader asks for it or the scene
 * cannot be drawn at all. The rest of the time it stays mounted but visually
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

/*
 * The two view glyphs. Each one is a small drawing of the thing it switches
 * to -- a ridge profile and a stack of rows -- rather than a symbol standing
 * for it, which is what lets them work with no words beside them. Hairlines in
 * currentColor, so the button's own ink/mute state carries them.
 */
const GLYPH = {
  width: 15,
  height: 12,
  viewBox: "0 0 16 13",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function ReliefGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M1 10.5 L4.5 4 L7 7.5 L10.5 2 L15 10.5" />
    </svg>
  );
}

function FlatGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M1 3 H15 M1 6.5 H9.5 M1 10 H13" />
    </svg>
  );
}

/*
 * The camera glyphs, in the same hairline dialect: plus and minus for the
 * zoom, and a frame with its mark re-centred for reset -- the picture put
 * back where it was composed.
 */
function ZoomInGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M8 2.5 V10.5 M4 6.5 H12" />
    </svg>
  );
}

function ZoomOutGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M4 6.5 H12" />
    </svg>
  );
}

function ResetGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M3.5 2.5 H12.5 V10.5 H3.5 Z" />
      <circle cx="8" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The hero: the landscape full-bleed with the headline set on it, the way a
 * map plate carries its title. The landscape is navigation, not decoration:
 * hovering reads a cell out in words along the bottom edge, clicking jumps
 * to the staple's section. The readout has a fixed height so hovering never
 * shifts anything.
 *
 * Two views of the one grid, and the reader picks. The relief is the default
 * everywhere, including phones; the flat ridgeline is a click away in the
 * bottom bar. It was always drawn -- it is what WebGL-less browsers get -- and
 * hiding a working chart behind a capability probe served nobody who simply
 * found the relief hard to read.
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
  const { hovered, selected, hoveredStore, setHovered, setHoveredStore, select, clear } =
    useSelection();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"relief" | "flat">("relief");
  const [sceneLive, setSceneLive] = useState(false);
  const [weatherOverride, setWeatherOverride] = useState<number | null>(null);
  // Where the reader's camera is. Away from home the headline yields -- the
  // hard gutter only holds at the composed framing, and terrain sliding
  // under live type is worse than type that steps aside.
  const [atHome, setAtHome] = useState(true);
  const [controls, setControls] = useState<TerrainControls | null>(null);

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

  // Without WebGL there is no choice to offer, so the control is not drawn and
  // the flat view is simply the hero.
  const canChoose = webgl === true;
  const flat = webgl === false || mode === "flat";
  const showScene = webgl === true && mode === "relief";

  // Picking Flat unmounts the scene, so the next Relief is a fresh mount with
  // no first frame drawn yet. Without this the wrapper is still at full
  // opacity from last time and the canvas appears mid-draw -- the fade below
  // would run once, on the first visit, and never again.
  useEffect(() => {
    if (!showScene) {
      setSceneLive(false);
      // The next mount starts at home with no API yet; stale controls would
      // be buttons wired to a scene that is gone.
      setAtHome(true);
      setControls(null);
    }
  }, [showScene]);

  const w = weatherOverride ?? clamp01(weather);
  // A live hover outranks the pin; the pin keeps the readout when the pointer
  // leaves, which is what makes a click feel like it held something.
  const shown = hovered ?? selected;
  const cell = grid && shown ? findCell(grid, shown) : null;
  // A crossing with no price is still a thing the reader pointed at, and the
  // readout owes them an answer rather than the axis blurb it shows at rest.
  const gap = grid && shown && !cell ? findGap(grid, shown) : null;

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

      {/* The headline rides under the scene: far summits still graze its
          descenders from below, but its column is a hard gutter the massif
          cannot enter at the home framing. When the reader pans or zooms
          away, the headline fades out entirely rather than letting land
          slide under type. pointer-events-none end to end: nothing in it is
          a control, and the terrain hover must pass through. */}
      <div
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-[1] max-w-[640px] px-5 pt-8 transition-opacity duration-300 sm:px-8 sm:pt-12",
          atHome ? "opacity-100" : "opacity-0",
        )}
      >
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
            hoveredStore={hoveredStore}
            onHover={setHovered}
            onHoverStore={setHoveredStore}
            onSelect={select}
            onClear={clear}
            onReady={() => setSceneLive(true)}
            onAtHomeChange={setAtHome}
            onControls={setControls}
          />
        </div>
      ) : null}
      {grid ? (
        /* Laid out when the reader asked for it, and when the scene cannot be
           drawn at all. `webgl` is null for the tick before the probe answers,
           and a chart that appears for that tick and then leaves reads as a
           placeholder that failed to clear -- so the layout is spent on a
           settled answer, never on the pending one. Mounted either way: the
           sr-only cell buttons inside are the landscape's keyboard and screen
           reader surface. */
        <div className={flat ? ridgeLayout : "sr-only"}>
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex min-h-[46px] items-end justify-between gap-4 px-5 pb-4 sm:px-8">
        <p
          aria-live="polite"
          className="border border-line bg-paper/85 px-2.5 py-1.5 text-[12.5px] backdrop-blur-[2px]"
        >
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
          ) : gap ? (
            /* Same three fields a priced cell fills, with the third one saying
               there is nothing to put there. No reason given: the grid drops a
               pin before it becomes a cell and never learns why, and the
               staple's section below names every excluded pin in full. */
            <>
              <span className="font-medium">{gap.storeName}</span>
              <span className="text-mute"> · </span>
              {gap.label}
              <span className="text-mute"> · </span>
              <span className="text-mute">{GAP_READING}</span>
            </>
          ) : (
            /* The axes are named here because nothing else names them any
               more: the store labels are down until one is pointed at, and a
               reader who never reaches for the landscape should still know
               what its floor is measuring. Worded to hold for both views --
               the staples run into depth in the relief and down the page in
               the flat one, but either way there is one to a row. */
            <span className="text-mute">
              Stores across, one staple to a row; height is how many times the cheapest store prices
              that staple, and the gold mark is a staple&apos;s cheapest shelf. Hover to read a
              price; click to open the staple below.
            </span>
          )}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          {showScene && controls ? (
            /* The camera's own buttons, in the same quiet chrome as the view
               pair beside them. Ctrl+scroll and drag do the fluent version of
               this; the buttons are the discoverable one, and Reset is the
               way back that dims once there is nowhere to go back from. */
            <div
              role="group"
              aria-label="Camera"
              className={cn(
                "pointer-events-auto flex items-center gap-1 border px-1.5 py-1 transition-colors hover:border-line hover:bg-paper/85 hover:backdrop-blur-[2px] focus-within:border-line focus-within:bg-paper/85 focus-within:backdrop-blur-[2px]",
                // Away from home the terrain can stand right behind these,
                // and mute hairlines on dark rock disappear -- the chip goes
                // solid for as long as the camera is out.
                atHome ? "border-transparent" : "border-line bg-paper/85 backdrop-blur-[2px]",
              )}
            >
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => controls.zoomOut()}
                className="p-1 text-mute transition-colors hover:text-ink"
              >
                <ZoomOutGlyph />
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => controls.zoomIn()}
                className="p-1 text-mute transition-colors hover:text-ink"
              >
                <ZoomInGlyph />
              </button>
              <button
                type="button"
                aria-label="Reset view"
                title="Reset view"
                disabled={atHome}
                onClick={() => controls.reset()}
                className={cn(
                  "p-1 transition-colors",
                  atHome ? "text-mute/40" : "text-mute hover:text-ink",
                )}
              >
                <ResetGlyph />
              </button>
            </div>
          ) : null}
          {canChoose ? (
            /* Two glyphs rather than two words, and no chrome until it is
               reached for. The words made a second paper chip in a corner that
               already has one, and the readout beside it is the thing worth
               reading. Both modes stay drawn, though, and the pair never
               fades: this is the only route to the flat view, and a control
               nobody finds is a control that is not there. */
            <div
              role="group"
              aria-label="Landscape view"
              className={cn(
                "pointer-events-auto flex items-center gap-1 border px-1.5 py-1 transition-colors hover:border-line hover:bg-paper/85 hover:backdrop-blur-[2px] focus-within:border-line focus-within:bg-paper/85 focus-within:backdrop-blur-[2px]",
                atHome ? "border-transparent" : "border-line bg-paper/85 backdrop-blur-[2px]",
              )}
            >
              {(["relief", "flat"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  aria-label={option === "relief" ? "Relief" : "Flat"}
                  title={option === "relief" ? "Relief" : "Flat"}
                  onClick={() => setMode(option)}
                  className={cn(
                    "p-1 transition-colors",
                    mode === option ? "text-ink" : "text-mute hover:text-ink",
                  )}
                >
                  {option === "relief" ? <ReliefGlyph /> : <FlatGlyph />}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
