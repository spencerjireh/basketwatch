"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { findCell, heightFor } from "@/lib/terrain/model";
import type { CellRef, TerrainCell, TerrainGrid } from "@/lib/terrain/model";
import { formatBasis, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * The landscape as terraces: one hipped prism per store-staple cell, rising
 * from a shared clay slab. Every shape on the board is an actual observation
 * -- there is no surface between stores, because no price exists between
 * stores -- and a missing cell is drawn as a dashed footprint on the slab:
 * a hole in the shelf, visibly a hole.
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
const ENTRANCE_SECONDS = 0.9;
const STAGGER_SECONDS = 0.06;

// Cells span their full grid step less a hairline crease, so neighbours share
// walls and the board reads as one carved massif instead of blocks on a table.
const PRISM_W = X_STEP * 0.97;
const PRISM_D = Z_STEP * 0.97;
const CHAMFER = 0.07; // rise of the bevelled lip below each terrace top
const CHAMFER_INSET = 0.09; // how far the lip pulls the top rim inward
const CLIFF_SHADE = 0.16; // how much near-vertical faces darken toward DEEP
const BASE_H = 0.1; // slab thickness

// A few degrees of pointer-driven drift; enough to separate the rows, not
// enough to read as a control.
const YAW_MAX = (3 * Math.PI) / 180;
const PITCH_MAX = (1.5 * Math.PI) / 180;

const CLAY = new THREE.Color("#e8e0d0");
const DEEP = new THREE.Color("#75634a");
const CHEAP = new THREE.Color("#4f7d62");
const HOVER = new THREE.Color("#2b271f");
const INK = "#1f1c18";
const LINE = "#e6e1d6";

type SceneProps = {
  grid: TerrainGrid;
  hovered: CellRef | null;
  selected: CellRef | null;
  onHover: (ref: CellRef | null) => void;
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
const stapleZ = (grid: TerrainGrid, row: number) =>
  ((grid.staples.length - 1) / 2 - row) * Z_STEP;

const peakHeight = (height: number) => H_BASE + height * H_MAX;
/** Where a ratio sits on the y axis -- the etched reference lines use the same map as the prisms. */
const ratioY = (ratio: number) => peakHeight(heightFor(ratio));

const slabWidth = (grid: TerrainGrid) => (grid.stores.length - 1) * X_STEP + FOOT * 2 + 1.4;
const slabDepth = (grid: TerrainGrid) => (grid.staples.length - 1) * Z_STEP + Z_STEP + 1.4;

const sameRef = (a: CellRef | null, b: CellRef): boolean =>
  a !== null && a.country === b.country && a.itemKey === b.itemKey && a.storeId === b.storeId;

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
  hovered,
  selected,
  onHover,
  onSelect,
  onClear,
  onReady,
}: SceneProps) {
  const [reduced, setReduced] = useState(false);
  const [hoverStoreId, setHoverStoreId] = useState<string | null>(null);

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
    <div ref={container} className="absolute inset-0" onPointerMove={placeTooltip}>
      <Canvas
        camera={{ fov: 30 }}
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
        frameloop="demand"
        onCreated={onReady}
        onPointerMissed={() => {
          onHover(null);
          onClear();
        }}
      >
        <Rig grid={grid} anchors={worldAnchors} labelEls={labelEls} parallax={!reduced} />
        <hemisphereLight args={["#fffdf6", "#d8cdb4", 0.7]} />
        <directionalLight
          position={[-11, 5.5, 4]}
          intensity={1.6}
          color="#fff3e0"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-normalBias={0.05}
          shadow-camera-left={-11}
          shadow-camera-right={11}
          shadow-camera-top={11}
          shadow-camera-bottom={-11}
          shadow-camera-far={40}
        />
        <Slab grid={grid} onHover={onHover} onClear={onClear} />
        <Etchings grid={grid} />
        <Terraces
          grid={grid}
          hovered={hovered}
          selected={selected}
          hoverStoreId={hoverStoreId}
          onHover={onHover}
          onSelect={onSelect}
          animate={!reduced}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
        {worldAnchors.map((anchor) => {
          if (anchor.kind === "store") {
            const storeId = anchor.key.slice("store:".length);
            return (
              <span
                key={anchor.key}
                ref={registerLabel(anchor.key)}
                onMouseEnter={() => setHoverStoreId(storeId)}
                onMouseLeave={() => setHoverStoreId(null)}
                className={cn(
                  "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-default whitespace-nowrap font-mono text-[11px] transition-colors",
                  hovered?.storeId === storeId || hoverStoreId === storeId
                    ? "text-ink"
                    : "text-ink/60",
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
                  "pointer-events-auto absolute -translate-x-full -translate-y-1/2 cursor-pointer whitespace-nowrap pr-1 font-mono text-[11px] transition-colors hover:text-ink",
                  hovered?.itemKey === itemKey ? "text-ink" : "text-ink/60",
                )}
                style={{ left: "-9999px", top: "0px" }}
              >
                {anchor.label}
              </button>
            );
          }
          if (anchor.kind === "summit") {
            return (
              <span
                key={anchor.key}
                ref={registerLabel(anchor.key)}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-full font-mono text-[10px] text-mute"
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
    // The fov fits the scene vertically; a narrow canvas needs the extra
    // distance or the flanks and their labels fall off the sides.
    const aspect = size.width / Math.max(1, size.height);
    const fit = Math.max(1, 1.2 / aspect);
    base.current.position.set(
      centroidX + w * 0.02,
      (4.9 + d * 0.38) * fit,
      (d / 2 + 8.7 + w * 0.3) * fit,
    );
    base.current.target.set(centroidX, 0.05, -d * 0.03);
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

    const b = base.current;
    const v = scratch.current.copy(b.position).sub(b.target);
    const spherical = new THREE.Spherical().setFromVector3(v);
    spherical.theta += s.yaw;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + s.pitch, 0.2, Math.PI / 2 - 0.05);
    camera.position.setFromSpherical(spherical).add(b.target);
    camera.lookAt(b.target);

    projectAnchors();

    if (Math.abs(targetYaw - s.yaw) > 0.0004 || Math.abs(targetPitch - s.pitch) > 0.0004) {
      invalidate();
    }
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
function Etchings({ grid }: { grid: TerrainGrid }) {
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
          new THREE.Float32BufferAttribute(
            [-w, y, -d, w, y, -d, w, y, d, -w, y, d],
            3,
          ),
        );
        return { ratio, geometry };
      });
  }, [grid]);
  useEffect(() => () => rings.forEach((ring) => ring.geometry.dispose()), [rings]);

  return (
    <group>
      {rings.map((ring) => (
        <lineLoop key={ring.ratio} geometry={ring.geometry} raycast={() => null}>
          <lineBasicMaterial color={INK} transparent opacity={0.15} />
        </lineLoop>
      ))}
    </group>
  );
}

/**
 * One terrace: four walls to a shoulder, a bevelled lip, a flat mesa top.
 * The corners of the lip are mitred -- adjacent lip quads share a diagonal
 * edge -- so the ring closes without extra corner geometry. Non-indexed so
 * computeVertexNormals gives crisp facets instead of smoothed corners.
 */
function buildPrismGeometry(h: number): THREE.BufferGeometry {
  const wx = PRISM_W / 2;
  const wz = PRISM_D / 2;
  const lip = Math.min(CHAMFER, h * 0.3); // short terraces keep a proportional lip
  const s = h - lip; // shoulder: top of the walls
  const ix = wx - CHAMFER_INSET;
  const iz = wz - CHAMFER_INSET;

  const positions: number[] = [];
  const tri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
  ) => positions.push(...a, ...b, ...c);
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
  ) => {
    tri(a, b, c);
    tri(a, c, d);
  };

  // Walls, wound to face outward.
  quad([-wx, 0, wz], [wx, 0, wz], [wx, s, wz], [-wx, s, wz]); // front
  quad([wx, 0, -wz], [-wx, 0, -wz], [-wx, s, -wz], [wx, s, -wz]); // back
  quad([wx, 0, wz], [wx, 0, -wz], [wx, s, -wz], [wx, s, wz]); // right
  quad([-wx, 0, -wz], [-wx, 0, wz], [-wx, s, wz], [-wx, s, -wz]); // left

  // The lip: outer shoulder rectangle up and in to the top rim.
  quad([-wx, s, wz], [wx, s, wz], [ix, h, iz], [-ix, h, iz]); // front
  quad([wx, s, -wz], [-wx, s, -wz], [-ix, h, -iz], [ix, h, -iz]); // back
  quad([wx, s, wz], [wx, s, -wz], [ix, h, -iz], [ix, h, iz]); // right
  quad([-wx, s, -wz], [-wx, s, wz], [-ix, h, iz], [-ix, h, -iz]); // left

  // The mesa top.
  quad([-ix, h, iz], [ix, h, iz], [ix, h, -iz], [-ix, h, -iz]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Vertex paint. The base ramp runs clay to deep with altitude -- dearer is
 * darker, the same number the height already carries -- and a stain (green
 * for the cheapest shelf, ink for attention) sits on the body while the base
 * stays clay, so every prism still reads as grown from the slab.
 */
function paintPrism(geometry: THREE.BufferGeometry, tint: THREE.Color | null, weight: number): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const color = geometry.getAttribute("color") as THREE.BufferAttribute;
  const scratch = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    scratch.copy(CLAY).lerp(DEEP, Math.min(1, (y / (H_BASE + H_MAX)) * 1.35));
    // The cliffs carry the relief: near-vertical faces sit a shade deeper
    // than the terrace tops, the way raking light reads on real terraces.
    if (Math.abs(normal.getY(i)) < 0.5) scratch.lerp(DEEP, CLIFF_SHADE);
    if (tint) {
      const grounding = Math.min(1, y / 0.3);
      scratch.lerp(tint, weight * grounding);
    }
    color.setXYZ(i, scratch.r, scratch.g, scratch.b);
  }
  color.needsUpdate = true;
}

function Terraces({
  grid,
  hovered,
  selected,
  hoverStoreId,
  onHover,
  onSelect,
  animate,
}: {
  grid: TerrainGrid;
  hovered: CellRef | null;
  selected: CellRef | null;
  hoverStoreId: string | null;
  onHover: (ref: CellRef | null) => void;
  onSelect: (ref: CellRef) => void;
  animate: boolean;
}) {
  // One dashed footprint shared by every gap: the outline of the prism that
  // is not there.
  const ghost = useMemo(() => {
    const wx = PRISM_W / 2;
    const wz = PRISM_D / 2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-wx, 0, -wz, wx, 0, -wz, wx, 0, wz, -wx, 0, wz],
        3,
      ),
    );
    geometry.setAttribute(
      "lineDistance",
      new THREE.Float32BufferAttribute(
        [0, PRISM_W, PRISM_W + PRISM_D, PRISM_W * 2 + PRISM_D],
        1,
      ),
    );
    return geometry;
  }, []);
  useEffect(() => () => ghost.dispose(), [ghost]);

  return (
    <group>
      {grid.staples.map((staple, row) =>
        (grid.cells[row] ?? []).map((cell, col) => {
          const store = grid.stores[col];
          if (!store) return null;
          if (!cell) {
            return (
              <lineLoop
                key={`ghost:${staple.itemKey}:${store.storeId}`}
                geometry={ghost}
                position={[storeX(grid, col), 0.01, stapleZ(grid, row)]}
                raycast={() => null}
              >
                <lineDashedMaterial color={INK} transparent opacity={0.28} dashSize={0.09} gapSize={0.07} />
              </lineLoop>
            );
          }
          return (
            <Prism
              key={`${grid.country}:${staple.itemKey}:${store.storeId}`}
              grid={grid}
              row={row}
              col={col}
              cell={cell}
              cellRef={{ country: grid.country, itemKey: staple.itemKey, storeId: store.storeId }}
              hovered={hovered}
              selected={selected}
              columnLit={hoverStoreId === store.storeId}
              onHover={onHover}
              onSelect={onSelect}
              animate={animate}
            />
          );
        }),
      )}
    </group>
  );
}

function Prism({
  grid,
  row,
  col,
  cell,
  cellRef,
  hovered,
  selected,
  columnLit,
  onHover,
  onSelect,
  animate,
}: {
  grid: TerrainGrid;
  row: number;
  col: number;
  cell: TerrainCell;
  cellRef: CellRef;
  hovered: CellRef | null;
  selected: CellRef | null;
  columnLit: boolean;
  onHover: (ref: CellRef | null) => void;
  onSelect: (ref: CellRef) => void;
  animate: boolean;
}) {
  const h = peakHeight(cell.height);
  const geometry = useMemo(() => buildPrismGeometry(h), [h]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const group = useRef<THREE.Group>(null);
  const progress = useRef(1);
  const invalidate = useThree((state) => state.invalidate);

  // The entrance, row by row with a slight sweep across the columns. The deps
  // are grid.country rather than grid on purpose: the stagger replays when
  // the country flips, not on every repaint of the same landscape.
  useEffect(() => {
    if (!group.current) return;
    progress.current = animate
      ? -(row * STAGGER_SECONDS + col * 0.015) / ENTRANCE_SECONDS
      : 1;
    group.current.scale.y = animate ? 0.001 : 1;
    invalidate();
  }, [grid.country, row, col, animate, invalidate]);

  useFrame((_, delta) => {
    if (!group.current || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + delta / ENTRANCE_SECONDS);
    const eased = 1 - Math.pow(1 - Math.max(0, progress.current), 3);
    group.current.scale.y = Math.max(0.001, eased);
    invalidate();
  });

  const isHovered = sameRef(hovered, cellRef);
  const isPinned = sameRef(selected, cellRef);

  useEffect(() => {
    if (isHovered) paintPrism(geometry, HOVER, 0.85);
    else if (isPinned) paintPrism(geometry, HOVER, 0.55);
    else if (columnLit) paintPrism(geometry, HOVER, 0.3);
    else if (cell.cheapest) paintPrism(geometry, CHEAP, 0.7);
    else paintPrism(geometry, null, 0);
    invalidate();
  }, [geometry, isHovered, isPinned, columnLit, cell.cheapest, invalidate]);

  return (
    <group ref={group} position={[storeX(grid, col), 0, stapleZ(grid, row)]}>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
          onHover(cellRef);
        }}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          // Without this the slab underneath sees the same move and clears
          // the hover that was just set.
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
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
      </mesh>

      {cell.cheapest ? (
        // The summit flag for the cheapest shelf: a small green cairn.
        <mesh position={[0, h + 0.11, 0]} raycast={() => null}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color="#1e7a4f" roughness={0.6} />
        </mesh>
      ) : null}
    </group>
  );
}
