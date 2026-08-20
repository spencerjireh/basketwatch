/**
 * The dashboard reads exactly one variable, and only on the server.
 *
 * Client code never needs an API base URL: it fetches relative /api paths, which
 * the rewrite in next.config.ts forwards. That is what keeps the browser bundle
 * free of any build-time host, and it is why there is no NEXT_PUBLIC_API_URL.
 */
export function apiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:3001";
}
