import {
  basketRailsResponseSchema,
  creditBudgetSchema,
  feedResponseSchema,
  fleetResponseSchema,
  incidentsResponseSchema,
  routes,
} from "@basketwatch/contract";
import { BehindBoard } from "@/components/behind/behind-board";
import { apiGet } from "@/lib/api/server";

export const metadata = {
  title: "Behind the data — Basketwatch",
  description: "The scraper fleet, the incidents, and every pin we do not fully believe.",
};

/**
 * The machinery, one click off the front page.
 *
 * It is here rather than on `/` because a shopper does not care about a credit
 * budget, and it is not buried because the fleet is the reason to believe the
 * prices. Rails are fetched across core and stretch here, not just core: a
 * mispin on an item outside the basket is exactly as wrong, it just does not
 * move the headline number.
 */
export default async function BehindPage() {
  const [fleet, feed, incidents, budget, rails] = await Promise.all([
    apiGet(routes.fleet, fleetResponseSchema),
    apiGet(routes.feed, feedResponseSchema),
    apiGet(routes.incidents, incidentsResponseSchema),
    apiGet(routes.budget, creditBudgetSchema),
    apiGet(`${routes.basketRails}?tier=core,stretch`, basketRailsResponseSchema),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] px-5 pb-24 pt-8">
      <section className="max-w-[62ch]">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em] [font-stretch:expanded]">
          Behind the data
        </h1>
        <p className="mt-2.5 text-[14px] text-mute">
          Prices come off nineteen store catalogues, and catalogues break. This is what the fleet
          is doing, what has gone wrong, and which pins we are not confident in — including the
          ones still feeding the front page.
        </p>
      </section>

      <div className="mt-6">
        <BehindBoard
          fleet={fleet}
          feed={feed.items}
          incidents={incidents.items}
          budget={budget}
          rails={rails}
          // Summed from the fleet rather than written down, so it cannot drift
          // away from what the stores actually returned.
          rowsLastPull={fleet.reduce((total, scraper) => total + scraper.lastRunRows, 0)}
        />
      </div>
    </main>
  );
}
