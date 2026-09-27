import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The editorial section. No box, no background: a hairline, a serif title,
 * and the content sitting directly on the paper.
 */
export function Section({
  title,
  caption,
  action,
  children,
  className,
}: {
  title: ReactNode;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rule min-w-0 pt-4", className)}>
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[20px] leading-snug">{title}</h2>
          {caption ? <p className="mt-1 max-w-[64ch] text-[12.5px] text-mute">{caption}</p> : null}
        </div>
        {action}
      </header>
      <div className="min-w-0 pt-4">{children}</div>
    </section>
  );
}
