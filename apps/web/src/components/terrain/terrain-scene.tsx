"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { findCell, heightFor } from "@/lib/terrain/model";
import type { CellRef, TerrainCell, TerrainGrid } from "@/lib/terrain/model";
import { formatBasis, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * The landscape as a relief: every mountain is a real price. Each priced
 * cell plants a smooth peak at its store-staple position, apex at exactly
 * its log-scaled ratio height, and the terrain is the upper envelope of all
 * of them -- the land between peaks is not interpolation, it is just how
 * mountains meet the ground. The land is one connected massif: neighbouring
 * peaks meet through cols whether they share a staple or a store, and where
 * a price is missing no mountain stands -- the land sags into a low pass,
 * and a dashed plot drapes over the spot nobody priced. The colors read off
 * the same scale as the heights: vegetation gives out where prices double,
 * snow begins where they quadruple, and the etched 2x and 4x lines cut the
 * same contours.
 *
 * Stores run across the width, staples recede into depth, and both axes are
 * labelled with DOM text projected from the camera -- the model has to be
 * readable before the first hover. The camera holds its composition but
 * drifts a few degrees with the pointer, which is what lets the back rows
 * resolve without handing the reader orbit controls to learn.
 *
 * This file is the only place in the app allowed to import three -- it is
 * loaded through a client-only dynamic import, so it never enters the server
 * bundle.
 */

const X_STEP = 2.3; // between stores, across
const Z_STEP = 1.18; // between staples, into depth
const FOOT = 0.8; // slab margin past the first and last store
const H_MAX = 2.0;
const H_BASE = 0.3; // the plinth: deep enough that a gap notch reads as a hole
const ENTRANCE_SECONDS = 1.4; // the rise from flat slab to full relief

// The mountain kernel: a C1 bump per priced cell, radii strictly smaller
// than the grid steps so every neighbour's kernel is exactly zero at any
// other cell centre -- which is what keeps every apex at exactly
// peakHeight. Between the peaks the land is carried by the interpolated
// massif (see heightAt); the kernels only have to shape the summits.
const KERNEL_RX = X_STEP * 0.8;
const KERNEL_RZ = Z_STEP * 0.78;
const FIELD_STEP = 0.09; // heightfield lattice pitch, world units
const RIM = 0.3; // field stops this far inside the slab edge
const FEATHER_W = 0.9; // width of the fall-to-zero band at the field rim
const NOISE_AMP = 0.05; // surface ripple; suppressed at apexes and clearings
const NOISE_SCALE = 0.55; // ripple lattice pitch, world units
const SAG_FLOOR = 0.33; // how far the land sags where no peak's own shape reaches
const SUPPORT_R = 2.0; // massif support radius, in grid steps
const STAIN_R = X_STEP * 0.55; // radius of a hover/pin stain, and of a column scan
const ROW_STAIN_R = Z_STEP * 0.55; // a row scan is narrower: staples sit closer than stores
const BASE_H = 0.1; // slab thickness

// A few degrees of pointer-driven drift; enough to separate the rows, not
// enough to read as a control.
const YAW_MAX = (3 * Math.PI) / 180;
const PITCH_MAX = (1.5 * Math.PI) / 180;

// The ambient drift at rest: half a degree of yaw on a ~48s breath, under
// the perception threshold as motion but enough that the scene reads as a
// place rather than a still. Costs a continuous render loop, which is why
// it shares the reduced-motion gate with the parallax.
const IDLE_YAW = (0.5 * Math.PI) / 180;
const IDLE_RATE = 0.13; // rad/s of the sine phase

const CLAY = new THREE.Color("#e8e0d0");
const HOVER = new THREE.Color("#2b271f");
const INK = "#1f1c18";
const LINE = "#e6e1d6";

// The relief palette carries the reading: green valley floors are cheap
// ground, the land dries to clay and rock as prices climb, and past the 4x
// ring the caps are rust -- a desaturated earth cousin of the broken red,
// so the expensive outlier reads as the alarming thing without a legend.
// The gold cairn still marks the cheapest shelf itself.
const PAPER = new THREE.Color("#faf7f2");
const VALLEY = new THREE.Color("#6f8f60");
const SCRUB = new THREE.Color("#b4a67a");
const ROCK_LOW = new THREE.Color("#a38662");
const ROCK_HIGH = new THREE.Color("#7d5a42");
const SNOW = new THREE.Color("#b56b50"); // the >4x cap; keeps the snowline plumbing, loses the snow
const GOLD = "#d4a72c";

// How hard depth pushes the far rows toward paper. This is the only fog we
// have -- see paintBase for why real fog is off the table.
const HAZE = 0.4;

// Scratch for the weather desaturation pass; module scope so painting 48k
// vertices allocates nothing.
const OVERCAST = new THREE.Color();

type SceneProps = {
  grid: TerrainGrid;
  /* 0 clear .. 1 overcast; the basket's own gaps, not a mood dial. */
  weather: number;
  hovered: CellRef | null;
  selected: CellRef | null;
  /** the store lit front to back, from wherever on the page it was pointed at */
  hoveredStore: string | null;
  onHover: (ref: CellRef | null) => void;
  onHoverStore: (storeId: string | null) => void;
  onSelect: (ref: CellRef) => void;
  onClear: () => void;
  onReady: () => void;
};

type WorldAnchor = {
  key: string;
  label: string;
  kind: "store" | "staple" | "summit" | "etch";
  x: number;
  y: number;
  z: number;
};

/** "Coffee (ground or instant)" earns its parenthetical in the sections, not on an axis. */
function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, "");
}

const storeX = (grid: TerrainGrid, col: number) => (col - (grid.stores.length - 1) / 2) * X_STEP;
/** Row 0 sits at the front, so the list order and the depth order agree. */
const stapleZ = (grid: TerrainGrid, row: number) => ((grid.staples.length - 1) / 2 - row) * Z_STEP;

const peakHeight = (height: number) => H_BASE + height * H_MAX;
/** Where a ratio sits on the y axis -- the etched reference lines use the same map as the prisms. */
const ratioY = (ratio: number) => peakHeight(heightFor(ratio));

const slabWidth = (grid: TerrainGrid) => (grid.stores.length - 1) * X_STEP + FOOT * 2 + 1.4;
const slabDepth = (grid: TerrainGrid) => (grid.staples.length - 1) * Z_STEP + Z_STEP + 1.4;

/**
 * Every label the DOM layer draws, in world coordinates. Pure per grid; the
 * screen positions are written imperatively by the Rig so that the labels
 * track the camera drift without a React render per frame.
 */
function buildWorldAnchors(grid: TerrainGrid): WorldAnchor[] {
  const anchors: WorldAnchor[] = [];
  const frontZ = stapleZ(grid, 0) + Z_STEP / 2 + 0.3;
  const leftX = storeX(grid, 0) - FOOT - 1.15;

  grid.stores.forEach((store, col) => {
    anchors.push({
      key: `store:${store.storeId}`,
      label: store.storeName,
      kind: "store",
      x: storeX(grid, col),
      y: 0,
      z: frontZ,
    });
  });
  grid.staples.forEach((staple, row) => {
    anchors.push({
      key: `staple:${staple.itemKey}`,
      label: shortLabel(staple.label),
      kind: "staple",
      x: leftX,
      y: 0,
      z: stapleZ(grid, row),
    });
  });

  // The tallest summit carries its multiple -- one number that teaches the
  // height scale without a legend. Below 2x the relief explains itself.
  let summit: { x: number; y: number; z: number; ratio: number } | null = null;
  grid.cells.forEach((rowCells, row) => {
    rowCells.forEach((cell, col) => {
      if (!cell) return;
      if (summit === null || cell.ratio > summit.ratio) {
        summit = {
          x: storeX(grid, col),
          y: peakHeight(cell.height) + 0.28,
          z: stapleZ(grid, row),
          ratio: cell.ratio,
        };
      }
    });
  });
  const top = summit as { x: number; y: number; z: number; ratio: number } | null;
  if (top && top.ratio >= 2) {
    anchors.push({
      key: "summit",
      label: `${top.ratio.toFixed(1)}x`,
      kind: "summit",
      x: top.x,
      y: top.y,
      z: top.z,
    });
  }

  // The etched reference lines get named at the slab's back-left corner.
  for (const ratio of [2, 4]) {
    if (grid.maxRatio >= ratio) {
      anchors.push({
        key: `etch:${ratio}`,
        label: `${ratio}x`,
        kind: "etch",
        x: -slabWidth(grid) / 2 - 0.2,
        y: ratioY(ratio),
        z: -slabDepth(grid) / 2,
      });
    }
  }

  return anchors;
}

export default function TerrainScene({
  grid,
  weather,
  hovered,
  selected,
  hoveredStore,
  onHover,
  onHoverStore,
  onSelect,
  onClear,
  onReady,
}: SceneProps) {
  const [reduced, setReduced] = useState(false);

  // Whether the rise has finished. The labels and the reference rings are
  // projected from full-height world anchors, so during the rise they would
  // hang in the air over flat land; they wait for the settle instead. Relief
  // reports it -- a callback, not a timer, because under a demand frameloop
  // wall-clock time can pass without the frames having run.
  const [settled, setSettled] = useState(false);
  const handleSettleChange = useCallback((value: boolean) => setSettled(value), []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listen = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", listen);
    return () => media.removeEventListener("change", listen);
  }, []);

  const worldAnchors = useMemo(() => buildWorldAnchors(grid), [grid]);

  // The DOM labels register themselves here; the Rig writes their screen
  // positions directly. Positions-as-state under a drifting camera would
  // re-render the label layer every frame -- the exact loop the old
  // projector's signature guard existed to prevent, removed structurally.
  const labelEls = useRef(new Map<string, HTMLElement>());
  const registerLabel = (key: string) => (el: HTMLElement | null) => {
    if (el) labelEls.current.set(key, el);
    else labelEls.current.delete(key);
  };

  const container = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);

  // Clicking an axis label lands on the staple the same way clicking a prism does.
  const rowRef = (itemKey: string): CellRef | null => {
    const row = grid.staples.findIndex((staple) => staple.itemKey === itemKey);
    const cell = grid.cells[row]?.find(Boolean);
    return cell ? { country: grid.country, itemKey, storeId: cell.storeId } : null;
  };

  const hoverCell = hovered ? findCell(grid, hovered) : null;

  const shadowExtent = Math.max(slabWidth(grid), slabDepth(grid)) / 2 + 2;

  // The tooltip follows the pointer imperatively: content changes only when
  // the hovered cell does, position on every move without a render.
  const placeTooltip = (event: React.PointerEvent) => {
    const box = container.current?.getBoundingClientRect();
    const el = tooltip.current;
    if (!box || !el) return;
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    el.style.left = `${x.toFixed(0)}px`;
    el.style.top = `${y.toFixed(0)}px`;
    el.style.transform =
      x > box.width * 0.68 ? "translate(calc(-100% - 14px), -120%)" : "translate(14px, -120%)";
  };

  return (
    <div
      ref={container}
      className="absolute inset-0"
      onPointerMove={placeTooltip}
      onPointerLeave={() => onHoverStore(null)}
    >
      <Canvas
        camera={{ fov: 30 }}
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
        frameloop="demand"
        onCreated={() => onReady()}
        onPointerMissed={() => {
          onHover(null);
          onClear();
        }}
      >
        <Rig grid={grid} anchors={worldAnchors} labelEls={labelEls} parallax={!reduced} />
        <hemisphereLight args={["#fffdf6", "#d8cdb4", 0.55]} />
        {/* A low warm sun so the ridges catch rim light, and a cold faint
            fill from behind so the shadowed faces keep their shape. The
            shadow box is sized from the slab: a fixed box clips the flank
            shadows once the grid grows past ten stores. Weather flattens
            the light: the sun dims and the cold fill gains, the way an
            overcast day trades contrast for shadowless grey. */}
        <directionalLight
          position={[-13, 4.2, 5]}
          intensity={1.7 - 0.55 * weather}
          color="#ffe9c2"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-normalBias={0.05}
          shadow-camera-left={-shadowExtent}
          shadow-camera-right={shadowExtent}
          shadow-camera-top={shadowExtent}
          shadow-camera-bottom={-shadowExtent}
          shadow-camera-far={40}
        />
        <directionalLight position={[9, 6, -9]} intensity={0.45 + 0.1 * weather} color="#f4ecdc" />
        <Slab grid={grid} onHover={onHover} onClear={onClear} />
        <Etchings grid={grid} visible={settled} />
        <Motes grid={grid} weather={weather} animate={!reduced} />
        <Relief
          grid={grid}
          weather={weather}
          hovered={hovered}
          selected={selected}
          scanStoreId={hovered?.storeId ?? hoveredStore}
          onHover={onHover}
          onSelect={onSelect}
          animate={!reduced}
          onSettleChange={handleSettleChange}
        />
      </Canvas>

      <div
        className={cn(
          "pointer-events-none absolute inset-0 hidden sm:block transition-opacity duration-500",
          // invisible, not just transparent: the store and staple labels are
          // pointer-events-auto, and they must not catch hovers mid-rise.
          settled ? "visible opacity-100" : "invisible opacity-0",
        )}
        aria-hidden="true"
      >
        {worldAnchors.map((anchor) => {
          if (anchor.kind === "store") {
            const storeId = anchor.key.slice("store:".length);
            const lit = hovered?.storeId === storeId || hoveredStore === storeId;
            return (
              /*
               * The store axis names one column and only while it is pointed
               * at -- from a prism up here, or from its bar in the ranking
               * below. At rest the hero is land and nothing else, which is the
               * whole reason the axis was quieted; a row of names standing
               * over it is a legend printed on a picture.
               *
               * Every label stays mounted and projected either way, so the one
               * that lights is already in position. Inert, though: an
               * invisible label with pointer events is a box that swallows the
               * hover meant for the prism underneath it.
               */
              <span
                key={anchor.key}
                ref={registerLabel(anchor.key)}
                className={cn(
                  // Lifted clear of its anchor rather than centred on it: on a
                  // shallow grid the front edge projects low enough that a
                  // centred label sits behind the readout chip.
                  //
                  // On paper, in the same survey tag the summit wears. Bare
                  // type here has to be read off the slab, the haze and a
                  // shadow at once, and it loses: the chip is what makes one
                  // name legible the instant it appears.
                  "pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap border border-line bg-paper/85 px-1.5 py-0.5 font-mono text-[11px] text-ink backdrop-blur-[2px] transition-opacity duration-200",
                  lit ? "opacity-100" : "opacity-0",
                )}
                style={{ left: "-9999px", top: "0px" }}
              >
                {anchor.label}
              </span>
            );
          }
          if (anchor.kind === "staple") {
            const itemKey = anchor.key.slice("staple:".length);
            return (
              <button
                key={anchor.key}
                ref={registerLabel(anchor.key)}
                type="button"
                tabIndex={-1}
                onClick={() => {
                  const ref = rowRef(itemKey);
                  if (ref) onSelect(ref);
                }}
                className={cn(
                  // Not the store name's paper tag: these sit out over bare
                  // paper, where a paper chip is invisible. The rule the nav
                  // already uses for "this is the live one" works here, and it
                  // is drawn transparent at rest so lighting a row cannot shift
                  // the column of names by a pixel.
                  //
                  // ink/60 to ink was too small a step to find at 11px beside a
                  // moving landscape; the weight and the rule together are not.
                  "pointer-events-auto absolute -translate-x-full -translate-y-1/2 cursor-pointer whitespace-nowrap border-b border-transparent pb-0.5 pr-1 font-mono text-[11px] transition-colors duration-200",
                  "hover:border-b-ink hover:text-ink",
                  hovered?.itemKey === itemKey
                    ? "border-b-ink font-medium text-ink"
                    : "text-ink/50",
                )}
                style={{ left: "-9999px", top: "0px" }}
              >
                {anchor.label}
              </button>
            );
          }
          if (anchor.kind === "summit") {
            return (
              /* The one number pinned to the land itself gets a survey-tag
                 chip, so the worst ratio reads as a measurement, not decor. */
              <span
                key={anchor.key}
                ref={registerLabel(anchor.key)}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+6px)] border border-line bg-paper/85 px-1.5 py-0.5 font-mono text-[10px] text-ink backdrop-blur-[2px]"
                style={{ left: "-9999px", top: "0px" }}
              >
                {anchor.label}
              </span>
            );
          }
          return (
            <span
              key={anchor.key}
              ref={registerLabel(anchor.key)}
              className="pointer-events-none absolute -translate-x-full -translate-y-1/2 pr-1 font-mono text-[10px] text-mute/80"
              style={{ left: "-9999px", top: "0px" }}
            >
              {anchor.label}
            </span>
          );
        })}
      </div>

      {hoverCell ? <Tooltip ref={tooltip} cell={hoverCell} /> : null}
    </div>
  );
}

function Tooltip({ ref, cell }: { ref: React.Ref<HTMLDivElement>; cell: TerrainCell }) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute z-10 whitespace-nowrap border border-line bg-paper/95 px-2.5 py-1.5 text-[11.5px] shadow-sm"
      style={{ left: "-9999px", top: "0px" }}
    >
      <span className="font-medium">{cell.storeName}</span>
      <span className="text-mute"> · </span>
      {cell.label}
      <span className="text-mute"> · </span>
      <span className="font-mono text-[11px]">
        {formatMoney(cell.unitPrice.amount, cell.unitPrice.currency)}
      </span>{" "}
      <span className="font-mono text-[10px] text-mute">{formatBasis(cell.unitPriceBasis)}</span>
      <span className="text-mute"> · </span>
      <span className={cell.cheapest ? "text-live" : "text-mute"}>
        {cell.cheapest ? "cheapest" : `${cell.ratio.toFixed(1)}x`}
      </span>
    </div>
  );
}

/**
 * Camera placement and drift, and the label projector in the same frame loop
 * so the two can never disagree. The base composition is the old fixed rig --
 * aimed at the height-weighted centroid of the peaks, fitted to the canvas
 * aspect -- and the pointer sways it a few degrees around that aim point,
 * easing home when the pointer settles. Under frameloop="demand" the loop
 * keeps itself alive with invalidate() only while it is still easing.
 */
function Rig({
  grid,
  anchors,
  labelEls,
  parallax,
}: {
  grid: TerrainGrid;
  anchors: WorldAnchor[];
  labelEls: React.RefObject<Map<string, HTMLElement>>;
  parallax: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const base = useRef({ position: new THREE.Vector3(), target: new THREE.Vector3() });
  const sway = useRef({ yaw: 0, pitch: 0 });
  const scratch = useRef(new THREE.Vector3());

  const projectAnchors = () => {
    camera.updateMatrixWorld();
    const point = scratch.current;
    for (const anchor of anchors) {
      const el = labelEls.current.get(anchor.key);
      if (!el) continue;
      point.set(anchor.x, anchor.y, anchor.z).project(camera);
      el.style.left = `${(((point.x + 1) / 2) * size.width).toFixed(1)}px`;
      el.style.top = `${(((1 - point.y) / 2) * size.height).toFixed(1)}px`;
    }
  };
  const projectRef = useRef(projectAnchors);
  projectRef.current = projectAnchors;

  useEffect(() => {
    const w = (grid.stores.length - 1) * X_STEP;
    const d = (grid.staples.length - 1) * Z_STEP;
    // Aim at the massif, not the grid: the height-weighted centroid of the
    // peaks, so a range that leans right (dear stores sort right) still sits
    // centered on the page instead of leaving a bank of dead paper.
    let weight = 0;
    let sumX = 0;
    grid.cells.forEach((rowCells) => {
      rowCells.forEach((cell, col) => {
        if (!cell) return;
        const h = peakHeight(cell.height);
        weight += h;
        sumX += storeX(grid, col) * h;
      });
    });
    const centroidX = weight > 0 ? (sumX / weight) * 0.55 : 0;
    // The fov fits the scene vertically, so the horizontal room a canvas has is
    // its aspect. A narrow one needs extra distance or the flanks and their
    // labels fall off the sides -- and so, less obviously, does a laptop-shaped
    // one: at 4:3 the slab ran past both edges and took the first and last
    // store's name with it. The middle term pulls back for those, capped so it
    // can never overtake the portrait case beside it.
    const aspect = size.width / Math.max(1, size.height);
    const fit = Math.max(1, 1.05 / aspect, Math.min(1.35, 1.9 / aspect));
    // The full-bleed frame shares its top-left with the headline, so the
    // massif is shifted right and aimed well above the ground line -- which
    // drops it low in the frame and leaves the type its clear air.
    //
    // The aim sits higher than it used to. The headline states the finding now
    // rather than labelling the picture, and a summit through a claim's
    // x-height costs more than the crossing is worth: the range should graze
    // the descenders and pass under the baseline, the way a range crosses a
    // map title without swallowing it.
    const shiftX = -w * 0.08;
    base.current.position.set(
      centroidX + w * 0.02 + shiftX,
      (8.2 + d * 0.56) * fit,
      (d / 2 + 11.8 + w * 0.34) * fit,
    );
    base.current.target.set(centroidX + shiftX, 0.8, -d * 0.1);
    camera.position.copy(base.current.position);
    camera.lookAt(base.current.target);
    camera.updateProjectionMatrix();
    projectRef.current();
    invalidate();
  }, [camera, size, grid, invalidate]);

  // The pointer only produces frames while the canvas is being pointed at;
  // each kick lets the easing below run itself quiet.
  useEffect(() => {
    if (!parallax) return;
    const el = gl.domElement;
    const kick = () => invalidate();
    el.addEventListener("pointermove", kick);
    el.addEventListener("pointerleave", kick);
    return () => {
      el.removeEventListener("pointermove", kick);
      el.removeEventListener("pointerleave", kick);
    };
  }, [gl, parallax, invalidate]);

  useFrame((state) => {
    if (!parallax) return;
    const targetYaw = state.pointer.x * YAW_MAX;
    const targetPitch = state.pointer.y * PITCH_MAX;
    const s = sway.current;
    s.yaw += (targetYaw - s.yaw) * 0.06;
    s.pitch += (targetPitch - s.pitch) * 0.06;

    const idle = Math.sin(state.clock.elapsedTime * IDLE_RATE) * IDLE_YAW;

    const b = base.current;
    const v = scratch.current.copy(b.position).sub(b.target);
    const spherical = new THREE.Spherical().setFromVector3(v);
    spherical.theta += s.yaw + idle;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + s.pitch, 0.2, Math.PI / 2 - 0.05);
    camera.position.setFromSpherical(spherical).add(b.target);
    camera.lookAt(b.target);

    projectAnchors();

    // The ambient drift never sleeps, so neither does the loop. The old
    // ease-to-quiet exit is gone with it; reduced motion still gets a
    // fully idle renderer via the early return above.
    invalidate();
  });

  return null;
}

/**
 * The shared base the terraces rise from: a thin clay slab whose top face is
 * y = 0, ruled with one hairline per store running the full depth so every
 * prism can be traced down to the store that priced it. Pointing at bare slab
 * is pointing at nothing -- it clears the hover, and clicking it unpins.
 */
function Slab({
  grid,
  onHover,
  onClear,
}: {
  grid: TerrainGrid;
  onHover: (ref: CellRef | null) => void;
  onClear: () => void;
}) {
  const lines = useMemo(() => {
    const positions: number[] = [];
    const backZ = stapleZ(grid, grid.staples.length - 1) - Z_STEP / 2 - 0.35;
    const frontZ = stapleZ(grid, 0) + Z_STEP / 2 + 0.35;
    for (let col = 0; col < grid.stores.length; col += 1) {
      positions.push(storeX(grid, col), 0.002, backZ, storeX(grid, col), 0.002, frontZ);
    }
    const x0 = storeX(grid, 0) - FOOT;
    const x1 = storeX(grid, grid.stores.length - 1) + FOOT;
    positions.push(x0, 0.002, frontZ, x1, 0.002, frontZ);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, [grid]);
  useEffect(() => () => lines.dispose(), [lines]);

  return (
    <group>
      <lineSegments geometry={lines} raycast={() => null}>
        <lineBasicMaterial color={LINE} />
      </lineSegments>
      <mesh
        position={[0, -BASE_H / 2, 0]}
        receiveShadow
        onPointerMove={() => onHover(null)}
        onClick={onClear}
      >
        <boxGeometry args={[slabWidth(grid), BASE_H, slabDepth(grid)]} />
        <meshStandardMaterial color={CLAY} roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}

/**
 * Reference lines etched around the slab at the 2x and 4x marks of the same
 * log scale the prisms use, so any two cells are comparable by eye without a
 * legend. The summit label still names the actual maximum; these teach the
 * scale between.
 */
function Etchings({ grid, visible }: { grid: TerrainGrid; visible: boolean }) {
  const rings = useMemo(() => {
    const w = slabWidth(grid) / 2;
    const d = slabDepth(grid) / 2;
    return [2, 4]
      .filter((ratio) => grid.maxRatio >= ratio)
      .map((ratio) => {
        const y = ratioY(ratio);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute([-w, y, -d, w, y, -d, w, y, d, -w, y, d], 3),
        );
        return { ratio, geometry };
      });
  }, [grid]);
  useEffect(() => () => rings.forEach((ring) => ring.geometry.dispose()), [rings]);

  return (
    <group>
      {rings.map((ring) => (
        <lineLoop key={ring.ratio} geometry={ring.geometry} raycast={() => null}>
          {/* Hidden until the rise settles: a ratio ring floating over flat
              land would mark nothing. Scaling them down with the relief is
              worse -- a moving 2x mark is a lie about the scale. */}
          <lineBasicMaterial color={INK} transparent opacity={visible ? 0.15 : 0} />
        </lineLoop>
      ))}
    </group>
  );
}

const MOTE_COUNT = 48;

/**
 * Dust in the valley air: a few dozen points drifting on slow sines, most of
 * them low where the green is. They live outside the lift group -- air does
 * not rise with the land -- and their drift rides the Rig's ever-running
 * frame loop rather than forcing frames of its own: under reduced motion
 * both loops idle and the dust simply hangs still. Overcast weather thins
 * them out; motes are the fair-weather state.
 */
function Motes({
  grid,
  weather,
  animate,
}: {
  grid: TerrainGrid;
  weather: number;
  animate: boolean;
}) {
  const motes = useMemo(() => {
    const w = slabWidth(grid) / 2 - RIM;
    const d = slabDepth(grid) / 2 - RIM;
    const base = new Float32Array(MOTE_COUNT * 3);
    const amp = new Float32Array(MOTE_COUNT * 3);
    const rate = new Float32Array(MOTE_COUNT);
    const phase = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      base[i * 3] = (hash2(i, 101) * 2 - 1) * w;
      // biased low: most dust hangs in the valley air, a few drift high
      base[i * 3 + 1] = 0.35 + 1.55 * Math.pow(hash2(i, 211), 1.6);
      base[i * 3 + 2] = (hash2(i, 307) * 2 - 1) * d;
      amp[i * 3] = 0.15 + 0.15 * hash2(i, 401);
      amp[i * 3 + 1] = 0.06 + 0.08 * hash2(i, 503);
      amp[i * 3 + 2] = 0.15 + 0.15 * hash2(i, 601);
      rate[i] = 0.05 + 0.07 * hash2(i, 701);
      phase[i] = hash2(i, 809) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
    return { geometry, base, amp, rate, phase };
  }, [grid]);
  useEffect(() => () => motes.geometry.dispose(), [motes]);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    const attr = motes.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      const s = Math.sin(t * motes.rate[i]! + motes.phase[i]!);
      const c = Math.cos(t * motes.rate[i]! * 0.8 + motes.phase[i]!);
      arr[i * 3] = motes.base[i * 3]! + motes.amp[i * 3]! * s;
      arr[i * 3 + 1] = motes.base[i * 3 + 1]! + motes.amp[i * 3 + 1]! * c;
      arr[i * 3 + 2] = motes.base[i * 3 + 2]! + motes.amp[i * 3 + 2]! * c;
    }
    attr.needsUpdate = true;
  });

  return (
    <points geometry={motes.geometry} raycast={() => null}>
      <pointsMaterial
        size={0.05}
        sizeAttenuation
        color="#c4b394"
        transparent
        opacity={0.35 * (1 - 0.75 * weather)}
        depthWrite={false}
      />
    </points>
  );
}

/** clamp-then-hermite; the one easing everything terrain-shaped here uses */
function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Deterministic 0..1 hash of a lattice point. No Math.random anywhere: the
 * same grid must always grow the same mountains. */
function hash2(i: number, j: number): number {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Bilinear value noise, 0..1 around 0.5, over a lattice of the given pitch. */
function valueNoise(x: number, z: number, scale: number = NOISE_SCALE): number {
  const u = x / scale;
  const v = z / scale;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = smoothstep01(u - i);
  const fv = smoothstep01(v - j);
  const a = hash2(i, j);
  const b = hash2(i + 1, j);
  const c = hash2(i, j + 1);
  const d = hash2(i + 1, j + 1);
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}

/** One real observation, planted as a mountain with its own character. */
type Peak = {
  cx: number;
  cz: number;
  apex: number;
  /** deterministic per-peak ellipse rotation; capped so the reach stays
   * under one grid step on both axes -- the bound that keeps every apex
   * exact and every clearing flat */
  cosA: number;
  sinA: number;
  rx: number;
  rz: number;
  /** kernel exponent: taller peaks stand steeper, low hills stay round */
  sharp: number;
};

function buildPeaks(grid: TerrainGrid): (Peak | null)[][] {
  return grid.cells.map((rowCells, row) =>
    rowCells.map((cell, col) => {
      if (!cell) return null;
      const apex = peakHeight(cell.height);
      const angle = (hash2(row * 31 + 7, col * 17 + 3) - 0.5) * (Math.PI / 6);
      const a = 1 + (hash2(row * 13 + 1, col * 29 + 11) - 0.5) * 0.2;
      const sharp =
        1.6 + (1.0 * (apex - H_BASE)) / H_MAX + (hash2(row * 41 + 5, col * 23 + 19) - 0.5) * 0.5;
      return {
        cx: storeX(grid, col),
        cz: stapleZ(grid, row),
        apex,
        cosA: Math.cos(angle),
        sinA: Math.sin(angle),
        rx: KERNEL_RX * a,
        rz: KERNEL_RZ / a,
        sharp,
      };
    }),
  );
}

/** The mountain profile: 1 at the centre, 0 at the ellipse edge, flat at the
 * edge, its steepness the peak's own. */
function peakKernel(peak: Peak, dx: number, dz: number): number {
  const du = dx * peak.cosA + dz * peak.sinA;
  const dv = -dx * peak.sinA + dz * peak.cosA;
  const d2 = (du / peak.rx) ** 2 + (dv / peak.rz) ** 2;
  if (d2 >= 1) return 0;
  return Math.pow(1 - d2, peak.sharp);
}

/**
 * The terrain, as a pure function of the observations. Three ingredients:
 * what height the land wants (an inverse-distance interpolation through
 * every apex, exact at each one), where land stands at all (a wide support
 * falling to zero two grid steps past the last observation), and the
 * summits' own shapes (the per-peak kernels). Their product joins
 * neighbouring peaks through cols on both axes -- staple to staple, store
 * to store -- sags into a low pass over a missing price, and still puts
 * every apex at exactly peakHeight. A ripple with a ridged octave carves
 * the working slopes and stays silent at summits and feet; everything
 * feathers to zero before the slab edge.
 */
function heightAt(grid: TerrainGrid, peaks: (Peak | null)[][], x: number, z: number): number {
  const cols = grid.stores.length;
  const rows = grid.staples.length;
  const colC = Math.round(x / X_STEP + (cols - 1) / 2);
  const rowC = Math.round((rows - 1) / 2 - z / Z_STEP);

  // env: the summits' own shapes; support: does land stand here at all.
  // Both reach at most two grid steps, so the 5x5 neighbourhood suffices.
  let env = 0;
  let support = 0;
  for (let row = rowC - 2; row <= rowC + 2; row += 1) {
    const rowPeaks = peaks[row];
    if (!rowPeaks) continue;
    for (let col = colC - 2; col <= colC + 2; col += 1) {
      const peak = rowPeaks[col];
      if (!peak) continue;
      const k = peakKernel(peak, x - peak.cx, z - peak.cz);
      if (k > env) env = k;
      const du = (x - peak.cx) / X_STEP;
      const dv = (z - peak.cz) / Z_STEP;
      const dg2 = (du * du + dv * dv) / (SUPPORT_R * SUPPORT_R);
      if (dg2 < 1) {
        const sup = (1 - dg2) ** 2;
        if (sup > support) support = sup;
      }
    }
  }

  // The wanted height: inverse-distance interpolation through every apex,
  // in grid units so a store-neighbour and a staple-neighbour pull alike.
  let base = 0;
  if (support > 0) {
    let wSum = 0;
    let hSum = 0;
    for (let row = 0; row < rows; row += 1) {
      const rowPeaks = peaks[row];
      if (!rowPeaks) continue;
      for (let col = 0; col < cols; col += 1) {
        const peak = rowPeaks[col];
        if (!peak) continue;
        const du = (x - peak.cx) / X_STEP;
        const dv = (z - peak.cz) / Z_STEP;
        const d2 = du * du + dv * dv;
        const weight = 1 / (d2 * Math.sqrt(d2) + 1e-6);
        wSum += weight;
        hSum += weight * peak.apex;
      }
    }
    const want = wSum > 0 ? hSum / wSum : 0;
    base = want * support * (SAG_FLOOR + (1 - SAG_FLOOR) * env);
  }

  // The ripple carries a ridged octave -- gullies on the working slopes --
  // and stays silent at summits and at the feet.
  const gully = (1 - Math.abs(2 * valueNoise(x + 137.7, z - 91.3, NOISE_SCALE * 0.6) - 1)) * 0.035;
  const ripple =
    ((valueNoise(x, z) - 0.5) * 2 * NOISE_AMP + gully) * smoothstep01(base / 0.3) * (1 - env);
  const w = slabWidth(grid) / 2 - RIM;
  const d = slabDepth(grid) / 2 - RIM;
  const feather =
    smoothstep01((w - Math.abs(x)) / FEATHER_W) * smoothstep01((d - Math.abs(z)) / FEATHER_W);
  return (base + ripple) * feather;
}

/**
 * A regular indexed lattice over the slab (inset by RIM), heights from
 * heightAt. Indexed on purpose -- shared vertices are what make
 * computeVertexNormals smooth, the deliberate inverse of the faceted look
 * this scene used to have.
 */
function buildFieldGeometry(grid: TerrainGrid, peaks: (Peak | null)[][]): THREE.BufferGeometry {
  const w = slabWidth(grid) / 2 - RIM;
  const d = slabDepth(grid) / 2 - RIM;
  const nx = Math.min(220, Math.ceil((w * 2) / FIELD_STEP)) + 1;
  const nz = Math.min(220, Math.ceil((d * 2) / FIELD_STEP)) + 1;

  const positions = new Float32Array(nx * nz * 3);
  let p = 0;
  for (let j = 0; j < nz; j += 1) {
    const z = -d + (2 * d * j) / (nz - 1);
    for (let i = 0; i < nx; i += 1) {
      const x = -w + (2 * w * i) / (nx - 1);
      positions[p] = x;
      positions[p + 1] = heightAt(grid, peaks, x, z);
      positions[p + 2] = z;
      p += 3;
    }
  }

  const index: number[] = [];
  for (let j = 0; j < nz - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const e = c + 1;
      index.push(a, c, b, b, c, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The base coat, painted once per grid and cached: elevation bands anchored
 * to the data scale (green fully out at ratioY(2), the rust cap from
 * ratioY(4)), steeper faces rockier, the rust dust thinning on cliffs, a
 * whisper of albedo grain, and haze baked toward paper by depth --
 * scene.fog is impossible on a transparent canvas, and camera-distance
 * haze would mean repainting every parallax frame for an invisible
 * difference. Weather washes the whole coat toward grey paper -- the
 * basket's own gaps thickening the air -- but stays under the rust cap,
 * for the same reason the depth haze does.
 */
function paintBase(
  grid: TerrainGrid,
  geometry: THREE.BufferGeometry,
  weather: number,
): Float32Array {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const y2 = ratioY(2);
  const y4 = ratioY(4);
  const zFront = stapleZ(grid, 0) + Z_STEP / 2;
  const zBack = stapleZ(grid, grid.staples.length - 1) - Z_STEP / 2;
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const slope = smoothstep01((1 - normal.getY(i) - 0.25) / 0.45);

    // Moisture decides where the green grows, so no two mountains wear the
    // same ring; the vegetation ceiling wanders but never crosses the 2x
    // mark, and the rust line wanders without moving its median off 4x --
    // the bands stay a legend even while they stop being stripes.
    const moisture = valueNoise(x + 61.7, z + 23.1, 1.7);
    const snowEdge = valueNoise(x - 300.5, z + 811.9, 0.9);

    c.copy(CLAY); // the foot stays plinth clay, so the diorama sits on it
    c.lerp(SCRUB, smoothstep01((y - 0.03) / 0.2));
    const greenTop = y2 * (0.6 + 0.4 * moisture);
    const veg =
      smoothstep01((greenTop - y) / (greenTop * 0.5)) *
      (1 - 0.8 * slope) *
      (0.4 + 0.6 * moisture) *
      smoothstep01((y - 0.03) / 0.12);
    c.lerp(VALLEY, veg * 0.85);
    const rock = smoothstep01((y - y2 * 0.5) / (y4 - y2 * 0.5));
    c.lerp(ROCK_LOW, rock * (1 - 0.7 * veg));
    c.lerp(ROCK_HIGH, smoothstep01((y - y2) / (y4 - y2)) * 0.8);
    c.lerp(ROCK_HIGH, 0.35 * slope);
    c.multiplyScalar(1 + (hash2(i, 12345) - 0.5) * 0.08);
    c.lerp(PAPER, HAZE * smoothstep01((zFront - z) / (zFront - zBack)));
    if (weather > 0) {
      const grey = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      c.lerp(OVERCAST.setRGB(grey, grey, grey), 0.35 * weather);
      c.lerp(PAPER, 0.18 * weather);
    }
    // The rust cap goes on after the haze: the worst outlier is often in the
    // back row, and an alarm that fades with distance is no alarm.
    const rustline = y4 + (snowEdge - 0.5) * 0.24;
    c.lerp(SNOW, smoothstep01((y - rustline) / 0.22) * (1 - 0.7 * slope));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  return colors;
}

type Stain = {
  x: number;
  z: number;
  weight: number;
  /** `cell` is a round blot; `column` runs front to back, `row` left to right */
  axis: "cell" | "column" | "row";
  radius: number;
};

/**
 * Attention as cloud shadow: restore the cached base coat, then darken
 * toward ink around each stain. Weights combine by max, not sum, so a
 * hovered cell inside a scanned column does not double-darken; the ink
 * target is unhazed, so a stained back-row cell punches through the haze.
 */
function applyStains(
  geometry: THREE.BufferGeometry,
  baseColors: Float32Array,
  stains: Stain[],
): void {
  const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
  const array = colorAttr.array as Float32Array;
  array.set(baseColors);
  if (stains.length > 0) {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      let w = 0;
      for (const stain of stains) {
        const dist =
          stain.axis === "column"
            ? Math.abs(x - stain.x)
            : stain.axis === "row"
              ? Math.abs(z - stain.z)
              : Math.hypot(x - stain.x, z - stain.z);
        const k = stain.weight * smoothstep01(1 - dist / stain.radius);
        if (k > w) w = k;
      }
      if (w > 0.003) {
        c.setRGB(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i));
        c.lerp(HOVER, w);
        colorAttr.setXYZ(i, c.r, c.g, c.b);
      }
    }
  }
  colorAttr.needsUpdate = true;
}

function Relief({
  grid,
  weather,
  hovered,
  selected,
  scanStoreId,
  onHover,
  onSelect,
  animate,
  onSettleChange,
}: {
  grid: TerrainGrid;
  weather: number;
  hovered: CellRef | null;
  selected: CellRef | null;
  scanStoreId: string | null;
  onHover: (ref: CellRef | null) => void;
  onSelect: (ref: CellRef) => void;
  animate: boolean;
  onSettleChange: (settled: boolean) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);

  const peaks = useMemo(() => buildPeaks(grid), [grid]);
  const geometry = useMemo(() => buildFieldGeometry(grid, peaks), [grid, peaks]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const baseColors = useMemo(() => paintBase(grid, geometry, weather), [grid, geometry, weather]);

  // The entrance: the whole relief rises out of the slab, prices pushing
  // the ground up. One scale on the group that already holds everything
  // that must rise together -- terrain, hit boxes and cairns.
  const lift = useRef<THREE.Group>(null);
  const progress = useRef(1);

  // The deps are grid.country rather than grid on purpose: the rise
  // replays when the country flips, not on every repaint of the same
  // landscape.
  useEffect(() => {
    progress.current = animate ? 0 : 1;
    // 0.001, never 0: a zero-determinant matrix breaks the normals.
    lift.current?.scale.setY(animate ? 0.001 : 1);
    onSettleChange(!animate);
    invalidate();
  }, [grid.country, animate, onSettleChange, invalidate]);

  useFrame((_, delta) => {
    if (progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + delta / ENTRANCE_SECONDS);
    const eased = 1 - Math.pow(1 - progress.current, 3);
    lift.current?.scale.setY(Math.max(0.001, eased));
    if (progress.current >= 1) onSettleChange(true);
    invalidate();
  });

  useEffect(() => {
    const stains: Stain[] = [];
    const cellStain = (ref: CellRef, weight: number, band = 0): void => {
      if (ref.country !== grid.country) return;
      const row = grid.staples.findIndex((staple) => staple.itemKey === ref.itemKey);
      const col = grid.stores.findIndex((store) => store.storeId === ref.storeId);
      if (row < 0 || col < 0) return;
      // Nothing is marked on a gap. A stain is how the land says "this price,
      // here", and over an empty crossing there is no price to point at -- the
      // sag is already the mark. The store's column still sweeps below, so the
      // reader keeps the one thing a gap can still tell them: whose shelf it is.
      if (!grid.cells[row]?.[col]) return;
      stains.push({
        x: storeX(grid, col),
        z: stapleZ(grid, row),
        weight,
        axis: "cell",
        radius: STAIN_R,
      });
      // The staple's whole row, left to right. A hovered store already gets its
      // column scanned; without this the other axis went unanswered, and a
      // reader could see which store a price came from but not which row of the
      // landscape they were reading along.
      if (band > 0) {
        stains.push({
          x: 0,
          z: stapleZ(grid, row),
          weight: band,
          axis: "row",
          radius: ROW_STAIN_R,
        });
      }
    };
    if (hovered) cellStain(hovered, 0.5, 0.22);
    if (selected) cellStain(selected, 0.32);
    // The whole store, front to back, as the shadow of a cloud crossing it.
    // This is the only mark a lit column gets: stakes standing over each
    // summit read louder than the summits, which are the subject.
    if (scanStoreId) {
      const col = grid.stores.findIndex((store) => store.storeId === scanStoreId);
      if (col >= 0) {
        stains.push({
          x: storeX(grid, col),
          z: 0,
          weight: 0.18,
          axis: "column",
          radius: STAIN_R,
        });
      }
    }
    applyStains(geometry, baseColors, stains);
    invalidate();
  }, [geometry, baseColors, grid, hovered, selected, scanStoreId, invalidate]);

  // The hit surface: an invisible box per cell -- the raycaster does not care
  // about visibility -- so a summit is still an easy target.
  //
  // Its height is the highest the land actually reaches inside this cell's own
  // footprint, read off `heightAt`, the same function the visible lattice is
  // built from. Which is to say the box is the silhouette of what this cell
  // owns, and neither of the two obvious cheaper answers is.
  //
  // The tallest apex in the 3x3 neighbourhood, which this used to be, hands a
  // cheap cell standing next to a big peak an invisible wall as tall as the
  // peak. From this camera, blocking the row behind takes about 1.0 of box, so
  // that wall ate whole rows the reader could plainly see.
  //
  // The cell's own apex fails the other way. The kernels only put the land at
  // the apex exactly at the cell centre; away from it the ground climbs toward
  // a tall neighbour, so a flat top at own-apex sinks under the visible massif
  // and pointing at real land hits nothing at all.
  const hitHeights = useMemo(() => {
    const nx = 7;
    const nz = 5;
    return grid.staples.map((_, row) =>
      grid.stores.map((__, col) => {
        const cx = storeX(grid, col);
        const cz = stapleZ(grid, row);
        let top = 0;
        for (let i = 0; i < nx; i += 1) {
          const x = cx + (i / (nx - 1) - 0.5) * X_STEP;
          for (let j = 0; j < nz; j += 1) {
            const z = cz + (j / (nz - 1) - 0.5) * (Z_STEP + 0.15);
            const h = heightAt(grid, peaks, x, z);
            if (h > top) top = h;
          }
        }
        // Clear of the surface, so a ray grazing the slope cannot slide along
        // the box's top face and miss the cell it is pointing straight at.
        return top + 0.08;
      }),
    );
  }, [grid, peaks]);

  return (
    <group ref={lift}>
      <mesh geometry={geometry} castShadow receiveShadow raycast={() => null}>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>

      {grid.staples.map((staple, row) =>
        (grid.cells[row] ?? []).map((cell, col) => {
          const store = grid.stores[col];
          if (!store) return null;
          // No `cell` guard: an empty crossing is pointable too. The land sags
          // where nobody priced, and a reader who can see the sag should be
          // able to ask what it is rather than watch the readout go blank.
          const x = storeX(grid, col);
          const z = stapleZ(grid, row);
          const cellRef: CellRef = {
            country: grid.country,
            itemKey: staple.itemKey,
            storeId: store.storeId,
          };
          const hit = hitHeights[row]?.[col] ?? 0.4;
          return (
            <group key={`${staple.itemKey}:${store.storeId}`}>
              <mesh
                visible={false}
                position={[x, hit / 2, z]}
                onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                  event.stopPropagation();
                  document.body.style.cursor = "pointer";
                  onHover(cellRef);
                }}
                onPointerMove={(event: ThreeEvent<PointerEvent>) => {
                  // Without this the slab underneath sees the same move and
                  // clears the hover that was just set.
                  event.stopPropagation();
                }}
                onPointerOut={() => {
                  document.body.style.cursor = "";
                  onHover(null);
                }}
                onClick={(event: ThreeEvent<MouseEvent>) => {
                  event.stopPropagation();
                  onSelect(cellRef);
                }}
              >
                <boxGeometry args={[X_STEP, hit, Z_STEP + 0.15]} />
              </mesh>
              {cell?.cheapest ? (
                // The summit flag for the cheapest shelf: a gold cairn --
                // the one colour the landscape itself never wears.
                <mesh position={[x, peakHeight(cell.height) + 0.11, z]} raycast={() => null}>
                  <sphereGeometry args={[0.06, 12, 12]} />
                  <meshStandardMaterial color={GOLD} roughness={0.5} />
                </mesh>
              ) : null}
            </group>
          );
        }),
      )}
    </group>
  );
}
