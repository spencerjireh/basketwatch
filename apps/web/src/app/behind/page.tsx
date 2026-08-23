import {
  basketRailsResponseSchema,
  fleetResponseSchema,
  routes,
} from "@basketwatch/contract";
import { BehindBoard } from "@/components/behind/behind-board";
import { CountryLink } from "@/components/country/country";
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
/**
 * Thirty seconds. Provenance and the quality worklist describe how the data is
 * built, not what the fleet is doing this second -- /healing is the page that
 * has to be live.
 */
export const revalidate = 30;

export default async function BehindPage() {
  // The fleet is still fetched, for the two provenance numbers -- how many
  // stores contribute and how many rows the last pull returned. What the fleet
  // is *doing* moved to /healing.
  const [fleet, rails] = await Promise.all([
    apiGet(routes.fleet, fleetResponseSchema, 30),
    apiGet(`${routes.basketRails}?tier=core,stretch`, basketRailsResponseSchema, 30),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] px-5 pb-24 pt-8">
      <section className="max-w-[62ch]">
        <h1 className="font-display text-[30px] leading-[1.15] tracking-[-0.01em]">
          Behind the data
        </h1>
        <p className="mt-2.5 text-[14px] text-mute">
          Prices come off nineteen store catalogues. This is where each number comes from, how it
          is stored, and which pins we are not confident in — including the ones still feeding the
          front page. What the fleet is doing when a catalogue breaks is on{" "}
          <CountryLink href="/healing" className="underline decoration-1 underline-offset-4">
            Self-healing
          </CountryLink>
          .
        </p>
      </section>

      <div className="mt-8">
        <BehindBoard fleet={fleet} rails={rails} />
      </div>
    </main>
  );
}
