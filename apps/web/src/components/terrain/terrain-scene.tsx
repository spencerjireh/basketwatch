"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CellRef, TerrainGrid } from "@/lib/terrain/model";
import { cn } from "@/lib/utils";

/*
 * The landscape in relief: one continuous ridge per staple, running across
 * the stores. Peaks sit exactly at store positions -- the only x values where
 * a price exists -- and the slope between two peaks is drawn smooth because
 * the eye wants a range, not a bar chart. A missing pin breaks the ridge into
 * separate hills with real ground between them: absence is absence.
 *
 * Stores run across the width, staples recede into depth, and both axes are
 * labelled with DOM text projected from the fixed camera -- the model has to
 * be readable before the first hover.
 *
 * This file is the only place in the app allowed to import three -- it is
 * loaded through a client-only dynamic import, so it never enters the server
 * bundle.
 */

const X_STEP = 2.3; // between stores, across
const Z_STEP = 1.18; // between staples, into depth
const RIDGE_HALF = Z_STEP / 2; // bases touch: valleys are creases, not paper
const FOOT = 0.8; // how far a ridge tapers past its first and last peak
const SUBDIV = 8; // samples per span of the smoothing spline
const H_MAX = 2.0;
const H_BASE = 0.14;
const ENTRANCE_SECONDS = 0.9;

const CLAY = new THREE.Color("#e8e0d0");
const DEEP = new THREE.Color("#75634a");
const CHEAP = new THREE.Color("#4f7d62");
const HOVER = new THREE.Color("#2b271f");
const INK = "#1f1c18";
const LINE = "#e6e1d6";

type SceneProps = {
  grid: TerrainGrid;
  hovered: CellRef | null;
  onHover: (ref: CellRef | null) => void;
  onSelect: (ref: CellRef) => void;
  onReady: () => void;
};

type Anchor = { key: string; label: string; x: number; y: number };
type Anchors = { staples: Anchor[]; stores: Anchor[]; summit: Anchor | null };

/** "Coffee (ground or instant)" earns its parenthetical in the sections, not on an axis. */
function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, "");
}

const storeX = (grid: TerrainGrid, col: number) => (col - (grid.stores.length - 1) / 2) * X_STEP;
/** Row 0 sits at the front, so the list order and the depth order agree. */
const stapleZ = (grid: TerrainGrid, row: number) =>
  ((grid.staples.length - 1) / 2 - row) * Z_STEP;

const peakHeight = (height: number) => H_BASE + height * H_MAX;

export default function TerrainScene({ grid, hovered, onHover, onSelect, onReady }: SceneProps) {
  const [reduced, setReduced] = useState(false);
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const anchorsSig = useRef("");

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listen = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", listen);
    return () => media.removeEventListener("change", listen);
  }, []);

  /*
   * Idempotence here is load-bearing, not an optimization. A state update
   * fired from a discrete r3f event re-renders the Canvas subtree, the
   * projector effect re-runs, and an unconditional setAnchors with a fresh
   * object would re-render the scene again -- a silent infinite loop that
   * pegs the main thread. Identical projections must not become state.
   */
  const handleAnchors = useCallback((next: Anchors) => {
    const sig = JSON.stringify(next);
    if (anchorsSig.current === sig) return;
    anchorsSig.current = sig;
    setAnchors(next);
  }, []);

  // Clicking an axis label lands on the staple the same way clicking a ridge does.
  const rowRef = (itemKey: string): CellRef | null => {
    const row = grid.staples.findIndex((staple) => staple.itemKey === itemKey);
    const cell = grid.cells[row]?.find(Boolean);
    return cell ? { country: grid.country, itemKey, storeId: cell.storeId } : null;
  };

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ fov: 30 }}
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
        frameloop="demand"
        onCreated={onReady}
        onPointerMissed={() => onHover(null)}
      >
        <Rig grid={grid} />
        <Projector grid={grid} onAnchors={handleAnchors} />
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
        <Sheet grid={grid} />
        <Relief grid={grid} hovered={hovered} onHover={onHover} onSelect={onSelect} animate={!reduced} />
      </Canvas>

      {anchors ? (
        <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
          {anchors.stores.map((store) => (
            <span
              key={store.key}
              className={cn(
                "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[11px] transition-colors",
                hovered?.storeId === store.key ? "text-ink" : "text-ink/60",
              )}
              style={{ left: `${store.x.toFixed(1)}px`, top: `${store.y.toFixed(1)}px` }}
            >
              {store.label}
            </span>
          ))}
          {anchors.summit ? (
            <span
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full font-mono text-[10px] text-mute"
              style={{
                left: `${anchors.summit.x.toFixed(1)}px`,
                top: `${anchors.summit.y.toFixed(1)}px`,
              }}
            >
              {anchors.summit.label}
            </span>
          ) : null}
          {anchors.staples.map((staple) => (
            <button
              key={staple.key}
              type="button"
              tabIndex={-1}
              onClick={() => {
                const ref = rowRef(staple.key);
                if (ref) onSelect(ref);
              }}
              className={cn(
                "pointer-events-auto absolute -translate-x-full -translate-y-1/2 cursor-pointer whitespace-nowrap pr-1 font-mono text-[11px] transition-colors hover:text-ink",
                hovered?.itemKey === staple.key ? "text-ink" : "text-ink/60",
              )}
              style={{ left: `${staple.x.toFixed(1)}px`, top: `${staple.y.toFixed(1)}px` }}
            >
              {staple.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The camera never moves; the model earns stillness by being labelled. */
function Rig({ grid }: { grid: TerrainGrid }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
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
    const centroidX = weight > 0 ? (sumX / weight) * 0.7 : 0;
    // The fov fits the scene vertically; a narrow canvas needs the extra
    // distance or the flanks and their labels fall off the sides.
    const aspect = size.width / Math.max(1, size.height);
    const fit = Math.max(1, 1.2 / aspect);
    camera.position.set(centroidX + w * 0.02, (6.8 + d * 0.5) * fit, (d / 2 + 7.2 + w * 0.28) * fit);
    camera.lookAt(centroidX, 0.05, -d * 0.03);
    camera.updateProjectionMatrix();
  }, [camera, size, grid]);
  return null;
}

/** Projects the axis anchor points once per layout; the labels are DOM text. */
function Projector({ grid, onAnchors }: { grid: TerrainGrid; onAnchors: (a: Anchors) => void }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useEffect(() => {
    camera.updateMatrixWorld();
    const point = new THREE.Vector3();
    const project = (x: number, y: number, z: number) => {
      point.set(x, y, z).project(camera);
      return { x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height };
    };

    const frontZ = stapleZ(grid, 0) + RIDGE_HALF + 0.3;
    const leftX = storeX(grid, 0) - FOOT - 0.55;

    // The tallest summit carries its multiple -- one number that teaches the
    // height scale without a legend. Below 2x the relief explains itself.
    type Summit = { x: number; y: number; z: number; ratio: number };
    let summit: Summit | null = null;
    for (let row = 0; row < grid.cells.length; row += 1) {
      const rowCells = grid.cells[row] ?? [];
      for (let col = 0; col < rowCells.length; col += 1) {
        const cell = rowCells[col];
        if (!cell) continue;
        if (summit === null || cell.ratio > summit.ratio) {
          summit = {
            x: storeX(grid, col),
            y: peakHeight(cell.height) + 0.28,
            z: stapleZ(grid, row),
            ratio: cell.ratio,
          };
        }
      }
    }

    onAnchors({
      stores: grid.stores.map((store, col) => ({
        key: store.storeId,
        label: store.storeName,
        ...project(storeX(grid, col), 0, frontZ),
      })),
      staples: grid.staples.map((staple, row) => ({
        key: staple.itemKey,
        label: shortLabel(staple.label),
        ...project(leftX, 0, stapleZ(grid, row)),
      })),
      summit:
        summit && summit.ratio >= 2
          ? {
              key: "summit",
              label: `${summit.ratio.toFixed(1)}x`,
              ...project(summit.x, summit.y, summit.z),
            }
          : null,
    });
  }, [camera, size, grid, onAnchors]);

  return null;
}

/**
 * Not a slab: a ruled sheet. One hairline per store runs the full depth, so
 * every peak can be traced down to the store that priced it, and the ridges
 * cast their shadows straight onto the page.
 */
function Sheet({ grid }: { grid: TerrainGrid }) {
  const lines = useMemo(() => {
    const positions: number[] = [];
    const backZ = stapleZ(grid, grid.staples.length - 1) - RIDGE_HALF - 0.35;
    const frontZ = stapleZ(grid, 0) + RIDGE_HALF + 0.35;
    for (let col = 0; col < grid.stores.length; col += 1) {
      positions.push(storeX(grid, col), 0, backZ, storeX(grid, col), 0, frontZ);
    }
    const x0 = storeX(grid, 0) - FOOT;
    const x1 = storeX(grid, grid.stores.length - 1) + FOOT;
    positions.push(x0, 0, frontZ, x1, 0, frontZ);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, [grid]);

  const w = (grid.stores.length - 1) * X_STEP + FOOT * 2 + 2.4;
  const d = (grid.staples.length - 1) * Z_STEP + RIDGE_HALF * 2 + 2.4;

  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={LINE} />
      </lineSegments>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <shadowMaterial transparent opacity={0.14} color={INK} />
      </mesh>
    </group>
  );
}

type RowGeometry = { geometry: THREE.BufferGeometry; maxY: number };

/**
 * One staple row as ridge geometry. Contiguous priced cells become one hill
 * chain -- a Catmull-Rom curve through the peaks, tapering to the ground a
 * little past the first and last store -- and every gap starts a new chain.
 * The cross-section is a tent: base at z +/- RIDGE_HALF, crest on the row line.
 */
function buildRowGeometry(grid: TerrainGrid, row: number): RowGeometry | null {
  const cells = grid.cells[row] ?? [];
  const z = stapleZ(grid, row);

  const runs: number[][] = [];
  let run: number[] = [];
  cells.forEach((cell, col) => {
    if (cell) run.push(col);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  if (runs.length === 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  let maxY = 0;

  for (const cols of runs) {
    // Control points: a grounded foot, the peaks, a grounded foot.
    const control: { x: number; y: number }[] = [
      { x: storeX(grid, cols[0] as number) - FOOT, y: 0 },
      ...cols.map((col) => {
        const y = peakHeight(cells[col]?.height ?? 0);
        maxY = Math.max(maxY, y);
        return { x: storeX(grid, col), y };
      }),
      { x: storeX(grid, cols[cols.length - 1] as number) + FOOT, y: 0 },
    ];

    // Catmull-Rom through the control points, endpoints duplicated.
    const stations: { x: number; y: number }[] = [];
    for (let i = 0; i < control.length - 1; i += 1) {
      const p0 = control[Math.max(0, i - 1)] as { x: number; y: number };
      const p1 = control[i] as { x: number; y: number };
      const p2 = control[i + 1] as { x: number; y: number };
      const p3 = control[Math.min(control.length - 1, i + 2)] as { x: number; y: number };
      const last = i === control.length - 2;
      for (let s = 0; s <= (last ? SUBDIV : SUBDIV - 1); s += 1) {
        const t = s / SUBDIV;
        const t2 = t * t;
        const t3 = t2 * t;
        const y =
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        const x =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        stations.push({ x, y: Math.max(0, y) });
      }
    }

    const start = positions.length / 3;
    for (const station of stations) {
      positions.push(station.x, 0, z + RIDGE_HALF); // front base
      positions.push(station.x, station.y, z); // crest
      positions.push(station.x, 0, z - RIDGE_HALF); // back base
    }
    for (let i = 0; i < stations.length - 1; i += 1) {
      const f0 = start + i * 3;
      const p0 = f0 + 1;
      const b0 = f0 + 2;
      const f1 = f0 + 3;
      const p1 = f0 + 4;
      const b1 = f0 + 5;
      indices.push(f0, f1, p1, f0, p1, p0); // front slope
      indices.push(b0, p1, b1, b0, p0, p1); // back slope
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, maxY };
}

/**
 * Vertex paint. The base ramp runs clay to deep with altitude -- dearer is
 * darker, the same number the height already carries -- then the cheapest
 * store's stretch of ridge is stained green and the hovered store's ink,
 * each fading out over about half a step.
 */
function colorize(
  geometry: THREE.BufferGeometry,
  cheapX: number | null,
  hoverX: number | null,
): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const color = geometry.getAttribute("color") as THREE.BufferAttribute;
  const scratch = new THREE.Color();
  const reach = X_STEP * 0.52;
  const cheapReach = X_STEP * 0.6;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    scratch.copy(CLAY).lerp(DEEP, Math.min(1, (y / (H_BASE + H_MAX)) * 2.1));
    const grounding = Math.min(1, y / 0.3); // bases stay clay so the stains sit on the crests
    if (cheapX !== null) {
      const w = Math.max(0, 1 - Math.abs(x - cheapX) / cheapReach) * grounding;
      if (w > 0) scratch.lerp(CHEAP, w);
    }
    if (hoverX !== null) {
      const w = Math.max(0, 1 - Math.abs(x - hoverX) / reach) * grounding;
      if (w > 0) scratch.lerp(HOVER, w * 0.9);
    }
    color.setXYZ(i, scratch.r, scratch.g, scratch.b);
  }
  color.needsUpdate = true;
}

function Relief({
  grid,
  hovered,
  onHover,
  onSelect,
  animate,
}: {
  grid: TerrainGrid;
  hovered: CellRef | null;
  onHover: (ref: CellRef | null) => void;
  onSelect: (ref: CellRef) => void;
  animate: boolean;
}) {
  return (
    <group>
      {grid.staples.map((staple, row) => (
        <Ridge
          key={`${grid.country}:${staple.itemKey}`}
          grid={grid}
          row={row}
          hovered={hovered}
          onHover={onHover}
          onSelect={onSelect}
          animate={animate}
        />
      ))}
    </group>
  );
}

const STAGGER_SECONDS = 0.06;

function Ridge({
  grid,
  row,
  hovered,
  onHover,
  onSelect,
  animate,
}: {
  grid: TerrainGrid;
  row: number;
  hovered: CellRef | null;
  onHover: (ref: CellRef | null) => void;
  onSelect: (ref: CellRef) => void;
  animate: boolean;
}) {
  const built = useMemo(() => buildRowGeometry(grid, row), [grid, row]);
  const cells = grid.cells[row] ?? [];
  const itemKey = grid.staples[row]?.itemKey ?? "";

  const group = useRef<THREE.Group>(null);
  const progress = useRef(1);
  const invalidate = useThree((state) => state.invalidate);

  // The entrance, row by row: each ridge rises a beat after the one in front
  // of it, so the range builds front to back instead of arriving as a block.
  useEffect(() => {
    if (!group.current) return;
    progress.current = animate ? -(row * STAGGER_SECONDS) / ENTRANCE_SECONDS : 1;
    group.current.scale.y = animate ? 0.001 : 1;
    invalidate();
  }, [grid.country, row, animate, invalidate]);

  useFrame((_, delta) => {
    if (!group.current || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + delta / ENTRANCE_SECONDS);
    const eased = 1 - Math.pow(1 - Math.max(0, progress.current), 3);
    group.current.scale.y = Math.max(0.001, eased);
    invalidate();
  });

  const cheapX = useMemo(() => {
    const col = cells.findIndex((cell) => cell?.cheapest);
    return col >= 0 ? storeX(grid, col) : null;
  }, [cells, grid]);

  const hoveredHere = hovered?.itemKey === itemKey ? hovered : null;
  const hoverPeak = useMemo(() => {
    if (!hoveredHere) return null;
    const col = grid.stores.findIndex((store) => store.storeId === hoveredHere.storeId);
    const cell = col >= 0 ? cells[col] : null;
    return cell ? { x: storeX(grid, col), y: peakHeight(cell.height) } : null;
  }, [hoveredHere, cells, grid]);
  const hoverX = hoverPeak?.x ?? null;

  // The survey stake over a hovered summit: a short vertical hairline rising
  // from the crest, since a line dropped to the ground would be buried inside
  // the ridge body. One persistent geometry, repositioned imperatively;
  // never raycast.
  const hairline = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    return geometry;
  }, []);
  useEffect(() => () => hairline.dispose(), [hairline]);

  useEffect(() => {
    if (built) colorize(built.geometry, cheapX, hoverX);
    if (hoverPeak) {
      const z = stapleZ(grid, row);
      const attr = hairline.getAttribute("position") as THREE.BufferAttribute;
      attr.set([hoverPeak.x, hoverPeak.y - 0.04, z, hoverPeak.x, hoverPeak.y + 0.55, z]);
      attr.needsUpdate = true;
      hairline.computeBoundingSphere();
    }
    invalidate();
  }, [built, cheapX, hoverX, hoverPeak, hairline, grid, row, invalidate]);

  if (!built) return null;

  // The raycast hits a smooth surface, so the cell is named by the nearest
  // store column that actually has a price on this row.
  const refAt = (x: number): CellRef | null => {
    let best: number | null = null;
    let bestDistance = Infinity;
    cells.forEach((cell, col) => {
      if (!cell) return;
      const distance = Math.abs(storeX(grid, col) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = col;
      }
    });
    if (best === null) return null;
    const cell = cells[best];
    return cell ? { country: grid.country, itemKey, storeId: cell.storeId } : null;
  };

  return (
    <group ref={group}>
      <mesh
        geometry={built.geometry}
        castShadow
        receiveShadow
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover(refAt(event.point.x));
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          onHover(null);
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          const ref = refAt(event.point.x);
          if (ref) onSelect(ref);
        }}
      >
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
      </mesh>

      <lineSegments
        geometry={hairline}
        visible={hoverPeak !== null}
        raycast={() => null}
      >
        <lineBasicMaterial color={INK} transparent opacity={0.55} />
      </lineSegments>

      {cells.map((cell, col) =>
        cell?.cheapest ? (
          // The summit flag for the cheapest shelf: a small green cairn.
          <mesh
            key={cell.storeId}
            position={[storeX(grid, col), peakHeight(cell.height) + 0.09, stapleZ(grid, row)]}
          >
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color="#1e7a4f" roughness={0.6} />
          </mesh>
        ) : null,
      )}
    </group>
  );
}
