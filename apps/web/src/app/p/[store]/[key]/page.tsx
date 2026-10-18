import Link from "next/link";
import { notFound } from "next/navigation";
import { productDetailSchema, routes, type ProductDetail } from "@basketwatch/contract";
import { HitRow } from "@/components/products/hit-row";
import { ApiError } from "@/lib/api/fetch-json";
import { apiGet } from "@/lib/api/server";
import { categoryLabel } from "@/lib/categories";
import { formatDay, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

type Params = { store: string; key: string };

async function load(params: Promise<Params>): Promise<ProductDetail> {
  const { store, key } = await params;
  try {
    return await apiGet(
      routes.product(decodeURIComponent(store), decodeURIComponent(key)),
      productDetailSchema,
      300,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const detail = await load(params);
  return {
    title: `${detail.product.name} at ${detail.product.storeName} — Basketwatch`,
    description: `Price history for ${detail.product.name} at ${detail.product.storeName}.`,
  };
}

/**
 * One store's product and every price we have seen for it. History is
 * change-only, so the chart is a step line: a price holds until the next
 * step. Other stores' products of the same parsed size sit underneath; they
 * look alike, which is not the same as being the same product.
 */
export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { product, history, listed, low90, median30, sameSize } = await load(params);
  const currency = product.price?.currency ?? "PHP";
  const money = (v: number) => formatMoney(v, currency);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[880px] px-5 pb-24 pt-8">
      <p className="font-mono text-[10.5px] text-mute">
        <Link href="/" className="hover:text-ink">
          Search
        </Link>{" "}
        / {product.storeName}
        {product.category ? ` · ${categoryLabel(product.category)}` : ""}
      </p>
      <h1 className="mt-2 max-w-[40ch] font-display text-[28px] leading-[1.15] tracking-[-0.01em]">
        {product.name}
      </h1>
      {!listed ? (
        <p className="mt-2 text-[13px] text-drift">
          No longer listed: last seen in the catalogue on {formatDay(product.lastSeen)}.
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        <Stat label="Now" value={product.price ? money(product.price.amount) : "not priced"} />
        <Stat label="30-day median" value={median30 === null ? "—" : money(median30)} />
        <Stat label="90-day low" value={low90 === null ? "—" : money(low90)} />
        <Stat
          label="Unit price"
          value={
            product.unitPrice && product.unitPriceBasis
              ? `${money(product.unitPrice.amount)} ${product.unitPriceBasis.replace("per_", "per ").replace("per item", "each")}`
              : "no size on the label"
          }
        />
      </dl>

      <section className="rule mt-8 pt-5" aria-labelledby="history">
        <h2 id="history" className="font-display text-[20px] leading-snug">
          Price history
        </h2>
        <p className="mt-1 text-[12.5px] text-mute">
          {history.length} price step{history.length === 1 ? "" : "s"} since{" "}
          {formatDay(product.firstSeen)}. A step is a change seen in a nightly pull.
        </p>
        <HistoryChart history={history} currency={currency} />
      </section>

      {product.url ? (
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-block text-[13px] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
        >
          Open at {product.storeName} →
        </a>
      ) : null}

      <section className="rule mt-10 pt-5" aria-labelledby="same-size">
        <h2 id="same-size" className="font-display text-[20px] leading-snug">
          Same size elsewhere
        </h2>
        <p className="mt-1 max-w-[64ch] text-[12.5px] text-mute">
          Listed products in other stores with the same parsed size and a similar name. Check the
          name: a similar name is not always the same product.
        </p>
        {sameSize.length === 0 ? (
          <p className="mt-4 text-[13px] text-mute">
            {product.sizeQuantity === null
              ? "The title gives no size to compare on."
              : "No other store lists a close match at this size."}
          </p>
        ) : (
          <ul className="rule mt-4 flex flex-col">
            {sameSize.map((hit) => (
              <HitRow key={`${hit.storeId}:${hit.productKey}`} hit={hit} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="caps">{label}</dt>
      <dd className="mt-1 font-mono text-[15px]">{value}</dd>
    </div>
  );
}

/** A step line over the whole history, on one price axis with three ticks. */
function HistoryChart({
  history,
  currency,
}: {
  history: ProductDetail["history"];
  currency: string;
}) {
  if (history.length === 0) return <p className="mt-4 text-[13px] text-mute">No prices yet.</p>;
  const W = 840;
  const H = 220;
  const left = 64;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const times = history.map((h) => Date.parse(h.at));
  const t0 = times[0]!;
  const t1 = Math.max(Date.now(), times.at(-1)! + 86_400_000);
  const values = history.map((h) => h.price);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    lo = lo * 0.95;
    hi = hi * 1.05;
  }
  const x = (t: number) => left + ((t - t0) / (t1 - t0)) * (W - left - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);

  let path = `M${x(t0).toFixed(1)},${y(values[0]!).toFixed(1)}`;
  history.slice(1).forEach((h, i) => {
    path += ` H${x(times[i + 1]!).toFixed(1)} V${y(h.price).toFixed(1)}`;
  });
  path += ` H${x(t1).toFixed(1)}`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

  return (
    <div className="mt-4 overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[480px]"
        role="img"
        aria-label={`Price from ${formatMoney(values[0]!, currency)} to ${formatMoney(values.at(-1)!, currency)}`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={W - right}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              className="text-line"
              strokeWidth="1"
            />
            <text
              x={left - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-mute font-mono text-[11px]"
            >
              {formatMoney(v, currency)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" className="text-ink" />
        {history.map((h, i) => (
          <circle key={h.at} cx={x(times[i]!)} cy={y(h.price)} r="2.5" className="fill-ink" />
        ))}
        <text x={left} y={H - 8} className="fill-mute font-mono text-[11px]">
          {formatDay(iso(t0))}
        </text>
        <text x={W - right} y={H - 8} textAnchor="end" className="fill-mute font-mono text-[11px]">
          today
        </text>
      </svg>
    </div>
  );
}
