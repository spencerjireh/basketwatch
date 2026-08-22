"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CellRef } from "@/lib/terrain/model";

type Selection = {
  hovered: CellRef | null;
  selected: CellRef | null;
  setHovered: (ref: CellRef | null) => void;
  select: (ref: CellRef) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

const sameRef = (a: CellRef | null, b: CellRef | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.country === b.country &&
    a.itemKey === b.itemKey &&
    a.storeId === b.storeId);

/**
 * The wire between the terrain and the text. Hover lights up a cell in the
 * readout; click pins the cell -- the readout and the highlight persist until
 * another cell is picked or empty ground is clicked -- and scrolls the page
 * to that staple's section.
 *
 * Two guards keep the wire from shorting. Hover updates for the cell already
 * hovered are dropped before they become state, so a stream of pointermove
 * events is free. And while the click-scroll glide is in flight, hover is
 * ignored altogether: the pointer sweeps dozens of rows on the way down, and
 * each one would otherwise repaint the relief mid-scroll -- on software WebGL
 * that repaint outlives the scroll frame and the two starve each other for
 * good.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [hovered, setHoveredState] = useState<CellRef | null>(null);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const scrolling = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setHovered = useCallback((ref: CellRef | null) => {
    if (scrolling.current) return;
    setHoveredState((previous) => (sameRef(previous, ref) ? previous : ref));
  }, []);

  const select = useCallback((ref: CellRef) => {
    setSelected(ref);
    setHoveredState(null);

    const target = document.getElementById(`staple-${ref.itemKey}`);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    scrolling.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    const release = () => {
      scrolling.current = false;
    };
    // scrollend is the real signal; the timeout is the fallback for browsers
    // without it and for glides the browser cuts short.
    window.addEventListener("scrollend", release, { once: true });
    scrollTimer.current = setTimeout(release, 1500);

    target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, []);

  const clear = useCallback(() => setSelected(null), []);

  const value = useMemo(
    () => ({ hovered, selected, setHovered, select, clear }),
    [hovered, selected, setHovered, select, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): Selection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside a SelectionProvider");
  return ctx;
}
