import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 py-1 font-mono text-[11px]",
        className,
      )}
    >
      {children}
    </span>
  );
}
