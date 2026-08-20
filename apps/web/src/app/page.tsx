import Link from "next/link";
import {
  basketIndexResponseSchema,
  basketRailsResponseSchema,
  basketTodayResponseSchema,
  countries,
  routes,
  type Country,
} from "@basketwatch/contract";
import { IndexChart } from "@/components/basket/index-chart";
import { RailList } from "@/components/basket/rail-list";
import { Receipt } from "@/components/basket/receipt";
import { Panel } from "@/components/ui/panel";
import { apiGet } from "@/lib/api/server";

/**
 * The shopper's surface.
 *
 * Three days of history cannot carry a page, so the hero is not a chart. What
 * nineteen stores can answer right now is what a basket costs and how far apart
 * the same staple is priced, and both of those are on screen before the reader
 * scrolls. The chart is kept, demoted, and honest about how little it has.
 */
export default async function Page() {
  const [basketIndex, basketItems, rails] = await Promise.all([
    apiGet(routes.basketIndex, basketIndexResponseSchema),
    apiGet(routes.basketToday, basketTodayResponseSchema),
    apiGet(routes.basketRails, basketRailsResponseSchema),
  ]);

  const totalStores = new Set(rails.flatMap((r) => r.pins.map((p) => p.storeId))).size;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] px-5 pb-24 pt-8">
      <section className="max-w-[62ch]">
        <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] [font-stretch:expanded]">
          What ten staples cost today.
        </h1>
        <p className="mt-3 text-[14px] text-mute">
          Priced off the shelf in {totalStores} stores across two countries, at the same quantities
          on both sides. Not a survey, and not an average — the cheapest unit price we can actually
          see.
        </p>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {countries.map((country) => {
          const items = basketItems.filter((item) => item.country === country);
          if (items.length === 0) return null;
          const series = basketIndex.find((s) => s.country === country);
          return (
            <Receipt
              key={country}
              country={country as Country}
              items={items}
              point={series?.points.at(-1)}
            />
          );
        })}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel
          title="Where the same staple costs different money"
          caption="One dot per store, placed by unit price on a log scale. Green is the cheapest; amber means the pack size is a range or a multipack, so its unit price is a midpoint."
        >
          <RailList rails={rails} />
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel
            title="Basket over time"
            caption="A gap is a day we could not price every staple, drawn as a gap rather than guessed across."
          >
            <IndexChart series={basketIndex} />
          </Panel>

          <Panel
            title="How we know"
            caption="Every number here came off a shelf, and we keep the receipts."
          >
            <p className="text-[13px] text-mute">
              Prices are read from each store&apos;s own catalogue, not from a panel or a survey.
              When a scraper breaks, the basket stops rather than carrying yesterday&apos;s number
              forward, and the pins we do not trust are excluded and named.
            </p>
            <Link
              href="/behind"
              className="mt-3 inline-block font-mono text-[11px] text-heal transition-colors hover:text-chalk"
            >
              Behind the data →
            </Link>
          </Panel>
        </div>
      </div>
    </main>
  );
}
