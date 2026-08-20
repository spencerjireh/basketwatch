import type { ZodType } from "zod";
import { fetchJson } from "./fetch-json.js";

/**
 * Client-component fetches, always relative.
 *
 * Same-origin means no CORS configuration anywhere and no API host baked into
 * the browser bundle at build time -- the property the old nginx setup provided,
 * preserved by the rewrite.
 */
export async function apiGetClient<T>(path: string, schema: ZodType<T>): Promise<T> {
  return fetchJson(path, schema);
}
