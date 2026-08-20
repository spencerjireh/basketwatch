import type { Response } from "express";

/** Server-sent events framing, with the headers that keep proxies honest. */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform matters as much as no-cache: a proxy that gzips the stream
  // will buffer it, and a buffered event stream is a stalled dashboard.
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // nginx and several CDNs buffer proxied responses by default. This opts out.
  "X-Accel-Buffering": "no",
} as const;

/** Comment frames keep intermediaries from timing out an idle connection. */
export const HEARTBEAT_INTERVAL_MS = 20_000;

export function writeSseHeaders(res: Response): void {
  for (const [key, value] of Object.entries(SSE_HEADERS)) {
    res.setHeader(key, value);
  }
  res.flushHeaders();
}

/**
 * One frame. The id field is what lets a browser resume: EventSource replays it
 * as Last-Event-ID on reconnect, so the server can send what was missed rather
 * than the whole feed again.
 */
export function writeSseEvent(res: Response, id: string, event: string, data: unknown): void {
  res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeSseHeartbeat(res: Response): void {
  res.write(": heartbeat\n\n");
}
