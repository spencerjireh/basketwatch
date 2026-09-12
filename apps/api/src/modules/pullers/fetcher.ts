import { Injectable, Logger } from "@nestjs/common";

/**
 * Catalogue payloads are far larger than page fetches -- Shop Gaisano's
 * products.json exceeds a megabyte by an order of magnitude. Truncation shows
 * up as a store returning zero rows rather than as an error, so the cap is
 * explicit and generous.
 */
export const API_MAX_BODY = 32_000_000;

const DEFAULT_TIMEOUT_MS = 30_000;

/** Standard browser headers: several of these stores serve degraded or empty pages to unidentified clients. */
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  accept: "application/json, text/html;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export type FetchResult = {
  status: number;
  body: string;
  truncated: boolean;
};

/**
 * HTTP client for the puller adapters: a plain fetch with browser headers, a
 * timeout, and a body cap. A failed request answers with status 0 rather than
 * throwing, so an adapter treats it like any other non-200.
 */
@Injectable()
export class Fetcher {
  private readonly logger = new Logger(Fetcher.name);

  async get(url: string, maxBody: number = API_MAX_BODY): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
      const body = await readCapped(response, maxBody);
      return { status: response.status, ...body };
    } catch (error) {
      this.logger.warn(`fetch failed for ${url}: ${message(error)}`);
      return { status: 0, body: "", truncated: false };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readCapped(
  response: Response,
  maxBody: number,
): Promise<{ body: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { body: "", truncated: false };

  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBody) {
      await reader.cancel();
      return { body, truncated: true };
    }
    body += decoder.decode(value, { stream: true });
  }
  return { body: body + decoder.decode(), truncated: false };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
