import Link from "next/link";
import {
  fuelResponseSchema,
  lpgResponseSchema,
  marketsResponseSchema,
  routes,
  srpResponseSchema,
  type FuelResponse,
  type LpgResponse,
  type MarketsResponse,
  type SrpResponse,
} from "@basketwatch/contract";
import { apiGet } from "@/lib/api/server";
import { formatDay, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "This week — Basketwatch",
  description:
    "Fuel pump prices by city and brand, the week's adjustment, LPG, wet-market prices and DTI suggested retail prices for Metro Manila.",
};

// Same reasoning as /behind: rendered per request, API answers cached briefly.
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

const peso = (n: number) => formatMoney(n, "PHP");
const range = (min: number, max: number) => (min === max ? peso(min) : `${peso(min)}–${peso(max)}`);

type Search = { product?: string; commodity?: string; q?: string };

/**
 * Prices that do not come from a store catalogue: DOE's weekly pump prices and
 * the Tuesday adjustment, DOE's monthly LPG range, DA's daily wet-market
 * prices, and DTI's suggested retail prices. Metro Manila, from the government
 * bulletins themselves. Every choice on the page is a link, so it works without
 * JavaScript and every view can be shared.
 */
export default async function ThisWeekPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const product = params.product ?? "RON 95";
  const [fuel, lpg, markets, srp] = await Promise.all([
    apiGet(`${routes.govFuel}?product=${encodeURIComponent(product)}`, fuelResponseSchema, 300),
    apiGet(routes.govLpg, lpgResponseSchema, 300),
    apiGet(
      `${routes.govMarkets}${params.commodity ? `?commodity=${encodeURIComponent(params.commodity)}` : ""}`,
      marketsResponseSchema,
      300,
    ),
    apiGet(
      `${routes.govSrp}${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`,
      srpResponseSchema,
      300,
    ),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1040px] px-5 pb-24 pt-8">
      <section className="max-w-[62ch]">
        <h1 className="font-display text-[30px] leading-[1.15] tracking-[-0.01em]">This week</h1>
        <p className="mt-2.5 text-[14px] text-mute">
          Pump prices, LPG, wet-market prices and suggested retail prices for Metro Manila, read
          from the Department of Energy, Department of Agriculture and Department of Trade and
          Industry bulletins.
        </p>
      </section>

      <FuelSection fuel={fuel} params={params} />
      <LpgSection lpg={lpg} />
      <MarketsSection markets={markets} params={params} />
      <SrpSection srp={srp} q={params.q ?? ""} />
    </main>
  );
}

function href(params: Search, change: Partial<Search>): string {
  const next = { ...params, ...change };
  const qs = new URLSearchParams(
    Object.entries(next).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return `/this-week${qs ? `?${qs}` : ""}`;
}

function Tabs({
  items,
  active,
  link,
}: {
  items: string[];
  active: string;
  link: (item: string) => string;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
      {items.map((item) => (
        <Link
          key={item}
          href={link(item)}
          scroll={false}
          aria-current={item === active ? "true" : undefined}
          className={cn(
            item === active
              ? "text-ink underline decoration-1 underline-offset-4"
              : "text-mute hover:text-ink",
          )}
        >
          {item}
        </Link>
      ))}
    </div>
  );
}

function FuelSection({ fuel, params }: { fuel: FuelResponse; params: Search }) {
  const adj = fuel.adjustment;
  return (
    <section className="rule mt-10 pt-6" aria-labelledby="fuel">
      <h2 id="fuel" className="font-display text-[22px]">
        Fuel at the pump
      </h2>
      {fuel.week ? (
        <p className="mt-1.5 text-[13px] text-mute">
          Week of {formatDay(fuel.week.start)} to {formatDay(fuel.week.end)}, lowest and highest
          price per brand in each city.
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-mute">No bulletin read yet.</p>
      )}
      <Tabs
        items={fuel.products}
        active={fuel.product}
        link={(p) => href(params, { product: p })}
      />

      {adj ? (
        <p className="mt-4 text-[15px]">
          This week&rsquo;s adjustment:{" "}
          <span className={cn(adj.max > 0 ? "text-broken" : "text-live")}>
            {adj.min > 0 ? "+" : ""}
            {range(adj.min, adj.max)} per litre
          </span>{" "}
          <span className="text-mute">from {formatDay(adj.effective)}</span>
        </p>
      ) : null}

      {fuel.history.length > 1 ? <MedianLine history={fuel.history} /> : null}

      {fuel.cities.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="py-2 pr-4 font-normal">City</th>
                <th className="py-2 pr-4 font-normal">Cheapest</th>
                <th className="py-2 font-normal">Others</th>
              </tr>
            </thead>
            <tbody>
              {fuel.cities.map((c) => {
                const [best, ...rest] = c.brands;
                return (
                  <tr key={c.city} className="border-b border-line align-top">
                    <td className="py-2 pr-4">{c.city}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {best ? (
                        <>
                          <span className="text-live">{best.brand}</span>{" "}
                          {range(best.min, best.max)}
                        </>
                      ) : null}
                    </td>
                    <td className="py-2 text-mute">
                      {rest.map((b) => `${b.brand} ${peso(b.min)}`).join(" · ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** The Metro Manila median of every brand's lowest price, week by week. */
function MedianLine({ history }: { history: FuelResponse["history"] }) {
  const W = 320;
  const H = 56;
  const values = history.map((h) => h.median);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (i / (history.length - 1)) * (W - 8) + 4;
  const y = (v: number) => (hi > lo ? H - 6 - ((v - lo) / (hi - lo)) * (H - 12) : H / 2);
  const points = history.map((h, i) => `${x(i).toFixed(1)},${y(h.median).toFixed(1)}`).join(" ");
  const last = history.at(-1)!;
  return (
    <figure className="mt-4 flex flex-wrap items-center gap-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="Median price by week"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-ink"
        />
        <circle cx={x(history.length - 1)} cy={y(last.median)} r="3" className="fill-live" />
      </svg>
      <figcaption className="text-[12px] text-mute">
        Median lowest price over {history.length} weeks: {peso(history[0]!.median)} on{" "}
        {formatDay(history[0]!.weekStart)}, {peso(last.median)} now.
      </figcaption>
    </figure>
  );
}

function LpgSection({ lpg }: { lpg: LpgResponse }) {
  const months = lpg.months.slice(-6).reverse();
  const month = (iso: string) =>
    new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  return (
    <section className="rule mt-10 pt-6" aria-labelledby="lpg">
      <h2 id="lpg" className="font-display text-[22px]">
        LPG, 11-kg cylinder
      </h2>
      {months.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-mute">No bulletin read yet.</p>
      ) : (
        <ul className="mt-4 grid gap-1.5 text-[14px]">
          {months.map((m, i) => (
            <li
              key={m.month}
              className={cn(
                "flex justify-between gap-6 border-b border-line py-1.5",
                i > 0 && "text-mute",
              )}
            >
              <span>{month(m.month)}</span>
              <span>{range(m.min, m.max)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MarketsSection({ markets, params }: { markets: MarketsResponse; params: Search }) {
  const active = params.commodity ?? markets.rows[0]?.commodity ?? "";
  const rows = markets.rows.filter((r) => r.commodity === active);
  return (
    <section className="rule mt-10 pt-6" aria-labelledby="markets">
      <h2 id="markets" className="font-display text-[22px]">
        Wet markets
      </h2>
      <p className="mt-1.5 text-[13px] text-mute">
        {markets.date
          ? `Department of Agriculture price watch, ${formatDay(markets.date)}. Cheapest market first.`
          : "No price watch read yet."}
      </p>
      <Tabs
        items={markets.commodities}
        active={active}
        link={(c) => href(params, { commodity: c })}
      />
      {rows.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="py-2 pr-4 font-normal">Item</th>
                <th className="py-2 pr-4 font-normal">Cheapest</th>
                <th className="py-2 font-normal">Markets priced</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const best = r.markets[0]!;
                const dearest = r.markets.at(-1)!;
                return (
                  <tr key={`${r.variant}-${r.unit}`} className="border-b border-line align-top">
                    <td className="py-2 pr-4">{r.variant}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {peso(best.price)}/{r.unit} <span className="text-mute">{best.market}</span>
                    </td>
                    <td className="py-2 text-mute whitespace-nowrap">
                      {r.markets.length}
                      {r.markets.length > 1 ? `, up to ${peso(dearest.price)}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function SrpSection({ srp, q }: { srp: SrpResponse; q: string }) {
  const items = q ? srp.items : srp.items.slice(0, 40);
  return (
    <section className="rule mt-10 pt-6" aria-labelledby="srp">
      <h2 id="srp" className="font-display text-[22px]">
        Suggested retail prices
      </h2>
      <p className="mt-1.5 text-[13px] text-mute">
        {srp.effective
          ? `DTI bulletin effective ${formatDay(srp.effective)}: the most a store should charge for these basic goods.`
          : "No bulletin read yet."}
      </p>
      <form action="/this-week#srp" className="mt-4 flex gap-2">
        <label htmlFor="srp-q" className="sr-only">
          Search suggested retail prices
        </label>
        <input
          id="srp-q"
          name="q"
          defaultValue={q}
          placeholder="sardines, noodles, bread…"
          className="w-full max-w-[320px] border border-line bg-paper px-3 py-1.5 text-[13px]"
        />
        <button type="submit" className="border border-line px-3 py-1.5 text-[13px] hover:bg-wash">
          Search
        </button>
      </form>
      {items.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <tbody>
              {items.map((i) => (
                <tr key={`${i.category}-${i.product}-${i.size}`} className="border-b border-line">
                  <td className="py-1.5 pr-4 text-mute">{i.category}</td>
                  <td className="py-1.5 pr-4">{i.product}</td>
                  <td className="py-1.5 pr-4 text-mute">{i.size}</td>
                  <td className="py-1.5 text-right">{peso(i.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!q && srp.items.length > items.length ? (
            <p className="mt-2 text-[12px] text-mute">
              Showing {items.length} of {srp.items.length}. Search to find the rest.
            </p>
          ) : null}
        </div>
      ) : q ? (
        <p className="mt-4 text-[13px] text-mute">
          Nothing in the bulletin matches &ldquo;{q}&rdquo;.
        </p>
      ) : null}
    </section>
  );
}
