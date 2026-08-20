import {
  basketIndexResponseSchema,
  basketTodayResponseSchema,
  creditBudgetSchema,
  feedResponseSchema,
  fleetResponseSchema,
  incidentsResponseSchema,
  routes,
} from "@basketwatch/contract";
import { Dashboard } from "@/components/layout/dashboard";
import { apiGet } from "@/lib/api/server";

/**
 * Server component: one round of fetches on first paint, six panels from six
 * endpoints.
 *
 * Concurrent rather than sequential, because the slowest panel should set the
 * page's latency, not the sum of all six. A failure in any one of them reaches
 * error.tsx, which is the honest outcome: a board showing five live panels and
 * one silently empty is worse than a board that says it could not load.
 */
export default async function Page() {
  const [fleet, basketIndex, basketItems, feed, incidents, budget] = await Promise.all([
    apiGet(routes.fleet, fleetResponseSchema),
    apiGet(routes.basketIndex, basketIndexResponseSchema),
    apiGet(routes.basketToday, basketTodayResponseSchema),
    apiGet(routes.feed, feedResponseSchema),
    apiGet(routes.incidents, incidentsResponseSchema),
    apiGet(routes.budget, creditBudgetSchema),
  ]);

  return (
    <Dashboard
      fleet={fleet}
      basketIndex={basketIndex}
      basketItems={basketItems}
      // Both endpoints are cursor-paginated; the board renders the first page
      // and the feed continues over SSE.
      feed={feed.items}
      incidents={incidents.items}
      budget={budget}
    />
  );
}
