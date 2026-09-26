/**
 * Path constants.
 *
 * API_PREFIX is set as Nest's global prefix with no exclusions, and Next
 * rewrites /api/* to the same path on the API without stripping anything. The
 * URL is therefore byte-identical whether you curl the container directly, go
 * through the dashboard in dev, or hit the public domain.
 */
export const API_PREFIX = "api";

export const routes = {
  health: "/api/health",
  ready: "/api/health/ready",
  fleet: "/api/fleet",
  basketIndex: "/api/basket/index",
  basketToday: "/api/basket/today",
  basketRails: "/api/basket/rails",
  feed: "/api/feed",
  stream: "/api/stream",
  incidents: "/api/incidents",
  incident: (id: string) => `/api/incidents/${id}`,
  productSearch: "/api/products/search",
} as const;
