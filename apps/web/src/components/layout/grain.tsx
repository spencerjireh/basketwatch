/*
 * Paper tooth for the whole page: a small tiled fractal-noise raster,
 * multiplied over everything at a whisper. The filter rasterizes once into
 * the tile and the fixed layer just composites, so scrolling repaints
 * nothing -- which is also why background-attachment: fixed is not used
 * here; that path forces a repaint per scroll frame.
 */
const NOISE = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="180" height="180" filter="url(#n)"/></svg>`,
);

export function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 opacity-[0.05] mix-blend-multiply"
      style={{
        backgroundImage: `url("data:image/svg+xml,${NOISE}")`,
        backgroundSize: "180px 180px",
      }}
    />
  );
}
