import "server-only";
import type { ZodType } from "zod";
import { apiBaseUrl } from "../env.js";
import { fetchJson } from "./fetch-json.js";

/**
 * Server-component fetches, absolute and straight to the API container.
 *
 * Deliberately a separate file from browser.ts with a server-only import, so
 * this cannot be pulled into a client component by autocomplete. Going direct
 * rather than through our own rewrite avoids the web server proxying to itself.
 */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  return fetchJson(`${apiBaseUrl()}${path}`, schema);
}
