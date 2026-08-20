import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The console's one container. Everything on the board sits in one of these. */
export function Panel({
  title,
  caption,
  action,
  children,
  className,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-panel)] border border-line bg-rail",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">{title}</h2>
          {caption ? <p className="mt-1 text-[12.5px] text-mute">{caption}</p> : null}
        </div>
        {action}
      </header>
      <div className="min-w-0 flex-1 p-4">{children}</div>
    </section>
  );
}
