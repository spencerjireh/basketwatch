"use client";

import type { FleetScraper, Rail } from "@basketwatch/contract";
import { QualityWorklist } from "@/components/behind/quality-worklist";
import { useCountry } from "@/components/country/country";
import { Section } from "@/components/ui/section";

/**
 * How the prices are known, and which of them we do not believe.
 *
 * The fleet board, the activity feed, the incidents and the heal dialog used to
 * live here too. They are the machinery rather than the provenance, and they
 * have their own page now -- this one answers a shopper's question, not an
 * operator's.
 *
 * Still a client component: both numbers below and the worklist follow the
 * country switcher, which lives in context.
 */
export function BehindBoard({
  fleet: wholeFleet,
  rails: allRails,
}: {
  fleet: FleetScraper[];
  rails: Rail[];
}) {
  const { country } = useCountry();

  const fleet = wholeFleet.filter((s) => s.country === country);
  const rails = allRails.filter((rail) => rail.country === country);

  const contributing = fleet.length;
  // Summed from the filtered fleet rather than written down, so it cannot
  // drift away from what the stores actually returned.
  const rowsLastPull = fleet.reduce((total, scraper) => total + scraper.lastRunRows, 0);

  return (
    <div className="grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Section title="Provenance" caption="Where the numbers on the front page come from.">
        <dl className="flex flex-col gap-3 text-[13px]">
          <Fact term={`${contributing} stores`}>
            Each publishes its own catalogue. Most are read over plain HTTP and cost nothing to
            check; the rest need a browser.
          </Fact>
          <Fact term={`${rowsLastPull.toLocaleString("en-US")} rows in the last pull`}>
            Every row carries a decomposed pack size where the title gave one, which is what makes
            a 5&nbsp;lb bag and a 5&nbsp;kg sack comparable at all.
          </Fact>
          <Fact term="Change-only history">
            A price is stored when it first appears or when it moves, never on every run. Each run
            also writes a summary row, which is what tells a truncated pull apart from a genuinely
            quiet day.
          </Fact>
          <Fact term="No carried-forward totals">
            A day that cannot price every staple in the basket scores no total. The chart draws the gap
            instead of interpolating across it.
          </Fact>
        </dl>
      </Section>

      <Section
        title="Data quality"
        caption="The pins we do not fully believe, and what is wrong with each one."
      >
        <QualityWorklist rails={rails} />
      </Section>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="caps text-ink">{term}</dt>
      <dd className="mt-0.5 text-mute">{children}</dd>
    </div>
  );
}
