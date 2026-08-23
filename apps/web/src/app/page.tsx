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
 * section at the bottom. Its headline and its flat twin belong to the client
 * boundary, because both answer to the country switcher.
 *
 * What is server-rendered here is the mid band: the answer a shopper actually
 * came for, the cheapest cart, and then what the basket has done over time.
 */
/**
 * Rendered per request, with the API call cached for 60 seconds.
 *
 * Not statically prerendered, deliberately: `next build` runs inside the web
 * image with no API container beside it, so prerendering this page means
 * fetching an address nothing is listening on. That is what broke every deploy
 * from #47 until this.
 *
 * force-dynamic alone would also drop the fetch cache, so fetchCache asks for
 * it back. The saving that mattered was never the prerender -- it was not
 * asking Postgres the same question once per visitor.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

export default async function Page() {
  const [basketIndex, basketItems, rails] = await Promise.all([
    apiGet(routes.basketIndex, basketIndexResponseSchema, 60),
    apiGet(routes.basketToday, basketTodayResponseSchema, 60),
    apiGet(routes.basketRails, basketRailsResponseSchema, 60),
  ]);

  // One band, two columns: the receipt on the left, the history filling the
  // paper the old stacked layout left dead on the right.
  const midBand = (
    <div className="mt-14 grid grid-cols-1 gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Section
        title="The cheapest cart"
        caption="The winning store for each staple, and what the whole basket costs if you buy every line at its winner."
      >
        <CheapestCart items={basketItems} index={basketIndex} />
      </Section>

      <Section
        title="The basket over time"
        caption="A gap is a day we could not price every staple, drawn as a gap rather than guessed across."
      >
        <IndexStrip series={basketIndex} />
      </Section>
    </div>
  );

  return (
    <main className="min-h-screen w-full pb-24">
      <BasketExplorer rails={rails} midBand={midBand} />

      <div className="mx-auto w-full max-w-[1240px] px-5">
        <Section
          className="mt-14"
          title="How we know"
          caption="Every number here came off a shelf, and we keep the receipts."
        >
          <p className="max-w-[52ch] text-[13px] text-mute">
            Prices are read from each store&apos;s own catalogue, not from a panel or a survey. When
            a scraper breaks, the basket stops rather than carrying yesterday&apos;s number forward,
            and the pins we do not trust are excluded and named.
          </p>
          <CountryLink
            href="/behind"
            className="mt-4 inline-block text-[13px] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
          >
            Behind the data →
          </CountryLink>
        </Section>
      </div>
    </main>
  );
}
