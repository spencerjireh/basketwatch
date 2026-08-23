import { Injectable, Logger } from "@nestjs/common";

/**
 * Catalogue payloads are far larger than page fetches -- Shop Gaisano's
 * products.json exceeds a megabyte by an order of magnitude. Truncation shows
 * up as a store returning zero rows rather than as an error, so the cap is
 * explicit and generous.
 */
export const API_MAX_BODY = 32_000_000;

const DEFAULT_TIMEOUT_MS = 30_000;

/** Bright Data Web Unlocker gets a longer leash -- the proxy adds latency. */
const UNLOCKER_TIMEOUT_MS = 90_000;

const UNLOCKER_API = "https://api.brightdata.com/request";
const UNLOCKER_ZONE = "cli_unlocker";

/** A browser-shaped UA: several of these stores refuse an obvious bot. */
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

export type FetchOptions = {
  /** Route through Bright Data Web Unlocker instead of direct fetch. */
  useUnlocker?: boolean;
  /** Two-letter country code for BD geo-targeting (e.g. "US", "PH"). */
  country?: string;
  maxBody?: number;
};

/**
 * HTTP client for the puller adapters.
 *
 * When `useUnlocker` is set, requests are routed through Bright Data's Web
 * Unlocker API (`POST https://api.brightdata.com/request`), ensuring all data
 * flows through BD infrastructure. The Unlocker does not execute JavaScript --
 * browser-required stores continue using Studio.
 *
 * Ported from the Python `UnlockerFetcher` in `lab/spencer-exploration/basket.py`.
 */
@Injectable()
export class Fetcher {
  private readonly logger = new Logger(Fetcher.name);
  private readonly apiKey = process.env.BRIGHTDATA_API_KEY ?? "";

  async get(url: string, opts?: FetchOptions): Promise<FetchResult>;
  /** @deprecated use the opts overload */
  async get(url: string, maxBody?: number): Promise<FetchResult>;
  async get(url: string, optsOrMax?: FetchOptions | number): Promise<FetchResult> {
    const opts: FetchOptions =
      typeof optsOrMax === "number" ? { maxBody: optsOrMax } : (optsOrMax ?? {});
    const maxBody = opts.maxBody ?? API_MAX_BODY;

    if (opts.useUnlocker) {
      return this.getViaUnlocker(url, opts.country ?? "US", maxBody);
    }
    return this.getDirect(url, maxBody);
  }

  private async getDirect(url: string, maxBody: number): Promise<FetchResult> {
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

  private async getViaUnlocker(
    url: string,
    country: string,
    maxBody: number,
  ): Promise<FetchResult> {
    if (!this.apiKey) {
      this.logger.warn("BRIGHTDATA_API_KEY not set, falling back to direct fetch");
      return this.getDirect(url, maxBody);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UNLOCKER_TIMEOUT_MS);
    try {
      const response = await fetch(UNLOCKER_API, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          zone: UNLOCKER_ZONE,
          url,
          format: "raw",
          country: country.toLowerCase(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(`unlocker returned ${response.status} for ${url}, falling back to direct`);
        return this.getDirect(url, maxBody);
      }

      const body = await readCapped(response, maxBody);
      // The unlocker intermittently answers 200 with an empty body (observed
      // on shopsuki.ph's sitemap, 2026-08-23) -- an "ok" that carries nothing
      // and reads downstream as an empty catalogue. Treat it like a failure.
      if (body.body.length === 0) {
        this.logger.warn(
          `unlocker returned 200 with empty body for ${url}, falling back to direct`,
        );
        return this.getDirect(url, maxBody);
      }
      return { status: response.status, ...body };
    } catch (error) {
      this.logger.warn(`unlocker failed for ${url}: ${message(error)}, falling back to direct`);
      return this.getDirect(url, maxBody);
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
