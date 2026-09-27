import "server-only";
import type { ZodType } from "zod";
import { apiBaseUrl } from "@/lib/env";
import { fetchJson } from "@/lib/api/fetch-json";

/**
 * Server-component fetches, absolute and straight to the API container.
 *
 * Deliberately a separate file from browser.ts with a server-only import, so
 * this cannot be pulled into a client component by autocomplete. Going direct
 * rather than through our own rewrite avoids the web server proxying to itself.
 */
export async function apiGet<T>(
  path: string,
  schema: ZodType<T>,
  /**
   * Seconds to cache for. Omit on anything operational: a page that exists to
   * show what is happening right now must not be served from a minute ago.
   */
  revalidate?: number,
): Promise<T> {
  return fetchJson(
    `${apiBaseUrl()}${path}`,
    schema,
    revalidate === undefined ? undefined : { next: { revalidate } },
  );
}
