"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type DropdownItem = { value: string; label: string };

/**
 * A small listbox, because the repo has no select primitive and does not want
 * a component library for one control.
 *
 * Native <select> would have been free, but it renders as the operating
 * system's widget and this sits in a header set in a display serif -- the one
 * place on the page where looking borrowed would show. The two existing
 * overlays hand-roll <dialog> for the same reason.
 */
export function Dropdown({
  label,
  items,
  value,
  onChange,
  className,
}: {
  label: string;
  items: DropdownItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    // pointerdown rather than click: a click listener fires after the button's
    // own handler has already toggled, which reopens what it just closed.
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const current = items.find((item) => item.value === value);

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => setOpen((prev) => !prev)}
        className="caps flex items-center gap-1.5 border-b border-ink pb-1 text-ink transition-colors hover:text-ink"
      >
        {current?.label ?? label}
        <span aria-hidden className={cn("text-[9px] transition-transform", open && "rotate-180")}>
          &#9662;
        </span>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute right-0 z-20 mt-1.5 min-w-[9rem] border border-line bg-paper py-1 shadow-sm"
        >
          {items.map((item) => {
            const selected = item.value === value;
            return (
              <li key={item.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "caps w-full px-3 py-1.5 text-left transition-colors",
                    selected ? "text-ink" : "text-mute hover:text-ink",
                  )}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
