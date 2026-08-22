import {
  basketIndexResponseSchema,
  basketRailsResponseSchema,
  basketTodayResponseSchema,
  routes,
} from "@basketwatch/contract";
import { BasketExplorer } from "@/components/basket/basket-explorer";
import { CheapestCart } from "@/components/basket/cheapest-cart";
import { IndexStrip } from "@/components/basket/index-strip";
import { CountryLink } from "@/components/country/country";
import { Section } from "@/components/ui/section";
import { apiGet } from "@/lib/api/server";

/**
 * The shopper's surface, gallery edition.
 *
 * The one theatrical thing on the page is the price landscape: stores across,
 * staples into depth, height = times the cheapest. It is navigation, not
 * decoration -- hover reads a point out in words, click lands on the staple
 * section at the bottom. Between the two sits the answer a shopper actually
 * came for: the cheapest cart, then what the basket has done over time.
 */
export default async function Page() {
  const [basketIndex, basketItems, rails] = await Promise.all([
    apiGet(routes.basketIndex, basketIndexResponseSchema),
    apiGet(routes.basketToday, basketTodayResponseSchema),
    apiGet(routes.basketRails, basketRailsResponseSchema),
  ]);

  const totalStores = new Set(rails.flatMap((r) => r.pins.map((p) => p.storeId))).size;

  const midBand = (
    <>
      <Section
        className="mt-14"
        title="The cheapest cart"
        caption="The winning store for each staple, and what the whole basket costs if you buy every line at its winner."
      >
        <CheapestCart items={basketItems} index={basketIndex} />
      </Section>

      <Section
        className="mt-14"
        title="The basket over time"
        caption="A gap is a day we could not price every staple, drawn as a gap rather than guessed across."
      >
        <div className="max-w-[860px]">
          <IndexStrip series={basketIndex} />
        </div>
      </Section>
    </>
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] px-5 pb-24 pt-10">
      <section className="max-w-[62ch]">
        <h1 className="font-display text-[34px] leading-[1.12] tracking-[-0.01em]">
          What ten staples cost today.
        </h1>
        <p className="mt-3 text-[14px] text-mute">
          Priced off the shelf in {totalStores} stores across two countries, at the same quantities
          in each. Not a survey, and not an average — the cheapest unit price we can actually
          see.
        </p>
      </section>

      <div className="mt-10">
        <BasketExplorer rails={rails} midBand={midBand} />
      </div>

      <Section
        className="mt-14"
        title="How we know"
        caption="Every number here came off a shelf, and we keep the receipts."
      >
        <p className="max-w-[52ch] text-[13px] text-mute">
          Prices are read from each store&apos;s own catalogue, not from a panel or a survey.
          When a scraper breaks, the basket stops rather than carrying yesterday&apos;s number
          forward, and the pins we do not trust are excluded and named.
        </p>
        <CountryLink
          href="/behind"
          className="mt-4 inline-block text-[13px] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
        >
          Behind the data →
        </CountryLink>
      </Section>
    </main>
  );
}
