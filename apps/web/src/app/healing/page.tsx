import {
  creditBudgetSchema,
  feedResponseSchema,
  fleetResponseSchema,
  incidentsResponseSchema,
  routes,
} from "@basketwatch/contract";
import { HealingBoard } from "@/components/healing/healing-board";
import { apiGet } from "@/lib/api/server";

export const metadata = {
  title: "Self-healing — Basketwatch",
  description: "What broke, what Bright Data proposed, and what it cost.",
};

/**
 * The machinery, on its own page.
 *
 * It used to share "Behind the data" with the provenance story, and the two
 * were arguing past each other: one says why the prices can be trusted, the
 * other says what the fleet is doing when they cannot be. This page is the
 * second, and it is the one worth watching during a demo.
 *
 * Nothing here can start a heal. Heals fire from the auto-heal loop or from
 * the ops API; the page shows them happening.
 */
/**
 * Deliberately uncached, and said out loud rather than left to the default.
 *
 * This is the page that answers "what is happening right now". A fleet board a
 * minute out of date during a live heal is the exact failure worth avoiding,
 * and it would read as a bug in the pipeline rather than in the cache.
 */
export const dynamic = "force-dynamic";

export default async function HealingPage() {
  const [fleet, feed, incidents, budget] = await Promise.all([
    apiGet(routes.fleet, fleetResponseSchema),
    apiGet(routes.feed, feedResponseSchema),
    // 100, not the default 50: the attempt history below is derived from these
    // incidents, so the page's memory is however many it asked for.
    apiGet(`${routes.incidents}?limit=100`, incidentsResponseSchema),
    apiGet(routes.budget, creditBudgetSchema),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] px-5 pb-24 pt-8">
      <section className="max-w-[62ch]">
        <h1 className="font-display text-[30px] leading-[1.15] tracking-[-0.01em]">
          Self-healing
        </h1>
        <p className="mt-2.5 text-[14px] text-mute">
          Store sites change without telling anyone, and a scraper that was right yesterday
          quietly returns nothing today. This is what the fleet is doing, what has broken, and
          what Bright Data proposed when it did — prompt, diff, verification and cost, every time.
        </p>
      </section>

      <div className="mt-8">
        <HealingBoard
          fleet={fleet}
          feed={feed.items}
          incidents={incidents.items}
          budget={budget}
        />
      </div>
    </main>
  );
}
