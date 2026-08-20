"use client";

import { useEffect, useRef, useState } from "react";
import type { ZodType } from "zod";

export type StreamStatus = "connecting" | "open" | "reconnecting" | "closed";

/**
 * One EventSource, one bounded buffer, one reconnect policy.
 *
 * Four things here are load-bearing and all four are easy to get wrong:
 *
 * 1. The effect genuinely closes the stream on cleanup. React Strict Mode
 *    double-invokes effects in dev, so a sloppy cleanup silently opens two.
 * 2. Every message is parsed by its contract schema and dropped with a warning
 *    if it fails. A malformed event must not white-screen the dashboard while a
 *    judge is looking at it.
 * 3. The buffer is bounded. A tab left open across a judging session otherwise
 *    grows without limit.
 * 4. EventSource auto-reconnects on a dropped connection but gives up
 *    permanently on a non-2xx response, so reconnection is explicit here, with
 *    capped exponential backoff and a status the UI can show.
 */
export function useEventStream<T>(
  path: string,
  schema: ZodType<T>,
  { max = 200, enabled = true }: { max?: number; enabled?: boolean } = {},
) {
  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<StreamStatus>(enabled ? "connecting" : "closed");
  const attempt = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(path);

      source.onopen = () => {
        attempt.current = 0;
        setStatus("open");
      };

      source.onmessage = (message) => {
        let raw: unknown;
        try {
          raw = JSON.parse(message.data as string);
        } catch {
          console.warn("stream: message was not JSON, dropped");
          return;
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          console.warn("stream: message did not match the contract, dropped");
          return;
        }
        setEvents((current) => [parsed.data, ...current].slice(0, max));
      };

      source.onerror = () => {
        source?.close();
        if (cancelled) return;
        setStatus("reconnecting");
        const backoff = Math.min(30_000, 1000 * 2 ** attempt.current);
        attempt.current += 1;
        retryTimer = setTimeout(connect, backoff);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      setStatus("closed");
    };
  }, [path, schema, max, enabled]);

  return { events, status };
}
