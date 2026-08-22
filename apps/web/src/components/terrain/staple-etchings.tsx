"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * The staple etchings: ten small line drawings in one hand -- contour
 * strokes with a little hatching, the way an old plate shades -- keyed by
 * the same itemKeys the grid uses. They render at watermark opacity in the
 * hero, so they are drawn bold and simple; dense crosshatch would just mud.
 *
 * (Named staple-etchings, not etchings: the terrain scene already has an
 * Etchings component for its 2x/4x rings.)
 */

function Plate({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The hatch voice: thinner than the contour, never louder than it. */
function Hatch({ d }: { d: string }) {
  return <path d={d} strokeWidth="0.7" opacity="0.8" />;
}

export const STAPLE_ETCHINGS: Record<string, ReactNode> = {
  // A rice panicle: the stem bows under its grains, botanical-plate style.
  rice: (
    <Plate>
      <path d="M34 106 C42 78 50 56 68 34 C74 27 80 22 88 18" />
      <path d="M34 106 C40 88 40 74 36 62" />
      <path d="M40 92 C52 88 60 80 64 70" />
      <ellipse cx="88" cy="18" rx="3" ry="5.5" transform="rotate(38 88 18)" />
      <ellipse cx="80" cy="25" rx="3" ry="5.5" transform="rotate(30 80 25)" />
      <ellipse cx="86" cy="33" rx="3" ry="5.5" transform="rotate(64 86 33)" />
      <ellipse cx="72" cy="33" rx="3" ry="5.5" transform="rotate(24 72 33)" />
      <ellipse cx="78" cy="42" rx="3" ry="5.5" transform="rotate(58 78 42)" />
      <ellipse cx="66" cy="43" rx="3" ry="5.5" transform="rotate(18 66 43)" />
      <ellipse cx="71" cy="52" rx="3" ry="5.5" transform="rotate(52 71 52)" />
      <ellipse cx="59" cy="54" rx="3" ry="5.5" transform="rotate(14 59 54)" />
      <Hatch d="M36 100 l7 -3 M38 94 l7 -3 M40 88 l6 -3" />
    </Plate>
  ),
  // A scored loaf, seen from the side.
  bread: (
    <Plate>
      <path d="M18 82 C16 66 26 50 46 46 C78 40 102 52 103 70 C104 78 100 82 94 82 L24 82 C20 82 18 82 18 82 Z" />
      <path d="M18 82 L103 82" strokeWidth="0.9" />
      <path d="M40 50 C46 56 48 62 47 68" />
      <path d="M58 46 C64 52 66 58 65 65" />
      <path d="M76 46 C82 52 84 58 83 64" />
      <Hatch d="M88 74 l8 -6 M84 78 l10 -8 M92 78 l7 -5" />
      <Hatch d="M22 88 h74" />
    </Plate>
  ),
  // Dry spaghetti in its paper wrap.
  pasta: (
    <Plate>
      <path d="M52 14 L44 106" />
      <path d="M57 13 L52 106" />
      <path d="M62 13 L60 106" />
      <path d="M67 13 L68 106" />
      <path d="M72 14 L76 106" />
      <path d="M47 15 L37 105" />
      <path d="M40 52 L82 52 L80 76 L38 76 Z" />
      <path d="M40 52 L38 76" />
      <Hatch d="M44 72 l4 -16 M50 72 l3 -16 M70 72 l-2 -16 M76 72 l-3 -16" />
    </Plate>
  ),
  // A hen in profile, tail up, mid-strut.
  chicken: (
    <Plate>
      <path d="M44 34 C42 28 46 24 49 27 C50 22 55 21 56 26 C58 22 62 24 61 29 C64 31 65 35 62 38" />
      <path d="M44 34 C40 38 39 44 42 48 C34 52 28 60 28 70 C28 84 40 92 56 92 C74 92 88 82 92 66 C96 52 90 44 84 48 C88 38 80 32 74 40 C70 30 62 30 62 38 C58 44 50 42 44 34 Z" />
      <path d="M42 42 L36 44 L42 47" />
      <path d="M46 48 C44 52 45 56 48 58" strokeWidth="0.9" />
      <path d="M48 66 C50 74 58 78 68 76 C74 75 78 70 78 64" strokeWidth="0.9" />
      <path d="M52 92 L52 102 L46 106 M52 102 L56 106 M52 102 L52 106" />
      <path d="M66 92 L66 102 L60 106 M66 102 L70 106 M66 102 L66 106" />
      <circle cx="49" cy="33" r="0.9" fill="currentColor" stroke="none" />
      <Hatch d="M36 76 l8 6 M34 70 l7 5 M40 82 l8 5" />
    </Plate>
  ),
  // Three eggs, one forward.
  eggs: (
    <Plate>
      <path d="M40 30 C50 30 56 40 56 50 C56 60 49 66 40 66 C31 66 24 60 24 50 C24 40 30 30 40 30 Z" />
      <path d="M80 26 C90 26 96 36 96 46 C96 56 89 62 80 62 C71 62 64 56 64 46 C64 36 70 26 80 26 Z" />
      <path d="M60 56 C72 56 80 68 80 80 C80 92 71 100 60 100 C49 100 40 92 40 80 C40 68 48 56 60 56 Z" />
      <Hatch d="M48 92 c4 3 9 4 13 3 M46 86 c5 4 11 5 16 3 M52 97 c3 1 6 1 9 0" />
      <Hatch d="M30 60 c3 2 7 3 10 2 M88 56 c3 1 5 1 7 0" />
    </Plate>
  ),
  // A milk bottle, capped and labelled.
  milk: (
    <Plate>
      <path d="M48 16 L72 16 L72 30 C72 36 80 40 80 50 L80 98 C80 102 77 104 73 104 L47 104 C43 104 40 102 40 98 L40 50 C40 40 48 36 48 30 Z" />
      <path d="M48 16 L48 30 M72 16 L72 30" strokeWidth="0.9" />
      <path d="M46 14 L74 14" />
      <path d="M40 62 L80 62 M40 80 L80 80" strokeWidth="0.9" />
      <path d="M50 68 h20" strokeWidth="0.7" />
      <path d="M50 73 h14" strokeWidth="0.7" />
      <Hatch d="M72 92 c2 -1 4 -2 5 -4 M70 97 c3 -1 6 -3 8 -6" />
      <Hatch d="M44 46 c1 -3 3 -6 5 -8" />
    </Plate>
  ),
  // A cup on its saucer, steam rising.
  coffee: (
    <Plate>
      <path d="M34 56 L86 56 C86 74 76 86 60 86 C44 86 34 74 34 56 Z" />
      <ellipse cx="60" cy="56" rx="26" ry="5" strokeWidth="0.9" />
      <path d="M86 60 C94 58 98 64 94 70 C91 74 86 74 84 72" />
      <path d="M28 94 C36 98 48 100 60 100 C72 100 84 98 92 94" />
      <path d="M28 94 L92 94" strokeWidth="0.7" />
      <path d="M52 44 C48 38 52 32 50 26 C49 22 50 18 52 16" strokeWidth="0.9" />
      <path d="M66 46 C62 40 66 34 64 28 C63 25 64 21 66 19" strokeWidth="0.9" />
      <Hatch d="M40 66 c2 6 6 11 11 14 M38 60 c1 4 3 8 6 11" />
    </Plate>
  ),
  // Sugar cubes, stacked; a few grains where they sit.
  sugar: (
    <Plate>
      <path d="M34 62 L60 56 L86 64 L86 88 L60 96 L34 86 Z" />
      <path d="M60 56 L60 76 M34 62 L60 70 L86 64 M60 70 L60 96" strokeWidth="0.9" />
      <path d="M44 38 L64 34 L80 40 L80 56 L64 61 L44 54 Z" />
      <path d="M64 34 L64 46 M44 38 L64 44 L80 40 M64 44 L64 61" strokeWidth="0.9" />
      <Hatch d="M38 74 l0 8 M44 76 l0 9 M50 78 l0 9 M56 79 l0 10" />
      <Hatch d="M66 78 l0 10 M72 76 l0 9 M78 74 l0 8" />
      <circle cx="30" cy="98" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="38" cy="102" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="88" cy="96" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="82" cy="101" r="0.8" fill="currentColor" stroke="none" />
    </Plate>
  ),
  // A bottle of oil, mid-pour drop at its lip.
  cooking_oil: (
    <Plate>
      <path d="M54 12 L66 12 L66 20 L64 24 L64 40 C64 46 76 50 76 62 L76 98 C76 102 73 104 69 104 L51 104 C47 104 44 102 44 98 L44 62 C44 50 56 46 56 40 L56 24 L54 20 Z" />
      <path d="M53 10 L67 10" />
      <path d="M44 70 L76 70 M44 88 L76 88" strokeWidth="0.9" />
      <path d="M50 76 h20 M50 81 h14" strokeWidth="0.7" />
      <path d="M82 26 C84 30 86 32 86 35 C86 38 84 40 82 40 C80 40 78 38 78 35 C78 32 80 30 82 26 Z" strokeWidth="0.9" />
      <Hatch d="M48 56 c2 -4 5 -7 8 -9 M46 62 c1 -3 3 -6 5 -8" />
    </Plate>
  ),
  // A hand of bananas from its crown.
  bananas: (
    <Plate>
      <path d="M74 16 L82 14 L86 22 L78 26" />
      <path d="M78 26 C74 48 62 72 40 86 C34 90 28 92 24 92 C22 88 22 84 24 78 C40 66 58 46 70 22" />
      <path d="M78 26 C78 50 70 78 52 96 C48 100 44 102 40 102 C38 98 38 94 40 88" />
      <path d="M80 24 C86 48 84 78 70 100 C68 103 65 105 62 106 C60 102 60 98 61 92" />
      <path d="M24 92 C22 94 21 96 21 98" strokeWidth="0.9" />
      <Hatch d="M66 34 c-8 18 -20 36 -34 48 M70 44 c-7 15 -17 29 -29 40" />
    </Plate>
  ),
};

/**
 * The hero watermark: one etching at a time, faint in the plate's clear air.
 * At rest it drifts through the basket on a slow crossfade, so the artwork
 * is present before anyone touches the massif; a hover or pin snaps to that
 * staple, mirroring the readout. Reduced motion holds a single static plate.
 */
export function StapleWatermark({
  staples,
  activeKey,
}: {
  staples: { itemKey: string }[];
  activeKey: string | null;
}) {
  const [idx, setIdx] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listen = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", listen);
    return () => media.removeEventListener("change", listen);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setIdx((i) => i + 1), 10000);
    return () => clearInterval(id);
  }, [reduced]);

  const keys = staples.map((s) => s.itemKey).filter((k) => STAPLE_ETCHINGS[k]);
  if (keys.length === 0) return null;
  const ambient = keys[idx % keys.length]!;
  const active = activeKey && STAPLE_ETCHINGS[activeKey] ? activeKey : ambient;

  return (
    <div className="relative aspect-square w-full" aria-hidden="true">
      {keys.map((key) => (
        <div
          key={key}
          className={cn(
            "absolute inset-0 transition-opacity",
            // a hover swap should feel held; the ambient drift should not be seen moving
            activeKey ? "duration-200" : "duration-[1600ms]",
            key === active ? "opacity-100" : "opacity-0",
          )}
        >
          {STAPLE_ETCHINGS[key]}
        </div>
      ))}
    </div>
  );
}
