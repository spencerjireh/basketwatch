"use client";

import { useEffect, useState } from "react";
import { plateSrc } from "@/lib/plates";
import { cn } from "@/lib/utils";

/**
 * One staple plate. Decorative everywhere it is used -- the staple is always
 * named in type beside it -- so it carries an empty alt and stays out of the
 * accessibility tree.
 *
 * A plain <img> rather than next/image: these are SVGs, already the size they
 * will be drawn, and the optimiser has nothing to do to them.
 */
export function StaplePlate({
  itemKey,
  fit = "contain",
  className,
}: {
  itemKey: string;
  /**
   * `contain` shows the whole plate and is right wherever it is the subject.
   * `cover` lets the row crop it, which is the point in the staple list: the
   * plate is meant to run past the edge, not sit inside a box. A prop rather
   * than a class because `cn` is a plain join and two object-fit utilities in
   * one list would resolve by stylesheet order.
   */
  fit?: "contain" | "cover";
  className?: string;
}) {
  const src = plateSrc(itemKey);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn(
        "h-full w-full",
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
    />
  );
}

/**
 * The hero watermark: one plate at a time in the plate's clear air, at half
 * the weight the rows use and scaled past the frame, so it reads as texture
 * behind the massif rather than as a second subject competing with it.
 *
 * At rest it drifts through the basket on a slow crossfade, so the art is
 * present before anyone touches the landscape; a hover or a pin snaps to that
 * staple, mirroring the readout. Reduced motion holds a single static plate.
 */
export function PlateWatermark({
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

  const keys = staples.map((s) => s.itemKey).filter((key) => plateSrc(key));
  if (keys.length === 0) return null;
  const ambient = keys[idx % keys.length]!;
  const active = activeKey && plateSrc(activeKey) ? activeKey : ambient;

  return (
    <div className="relative h-full w-full" aria-hidden="true">
      {keys.map((key) => (
        <div
          key={key}
          className={cn(
            "absolute inset-0 transition-opacity",
            // a hover swap should feel held; the ambient drift should not be
            // seen moving
            activeKey ? "duration-200" : "duration-[1600ms]",
            key === active ? "opacity-100" : "opacity-0",
          )}
        >
          <StaplePlate itemKey={key} />
        </div>
      ))}
    </div>
  );
}
