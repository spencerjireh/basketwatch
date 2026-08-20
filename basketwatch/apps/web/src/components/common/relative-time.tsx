"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatRelative } from "@/lib/format";

/**
 * Absolute on first paint, relative once mounted.
 *
 * Date.now() during render produces a different value on the server than in the
 * browser, which is a guaranteed hydration mismatch. Rendering the absolute
 * string first means server and client agree, and the relative form arrives in
 * an effect where the clock is allowed to differ.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className}>
      {now === null ? formatDateTime(iso) : formatRelative(iso, now)}
    </time>
  );
}
