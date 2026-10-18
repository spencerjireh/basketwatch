import Link from "next/link";
import {
  dropsResponseSchema,
  productSearchResponseSchema,
  routes,
  type ProductHit,
  type ProductSearchResponse,
  type SrpReference,
} from "@basketwatch/contract";
import { HitRow, collapseListings } from "@/components/products/hit-row";
import { StaplePlate } from "@/components/plates/staple-plate";
import { apiGet } from "@/lib/api/server";
import { CATEGORIES, categoryLabel } from "@/lib/categories";
import { formatDay, formatMoney } from "@/lib/format";
import { PLATE_KEYS, PLATE_SEARCH } from "@/lib/plates";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Basketwatch",
  description:
    "Search shelf prices across Philippine stores, with each product's price history and this week's biggest drops.",
};

/** Same pair as /basket: no prerender against an API that is not there at build time. */
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

type Search = { q?: string; category?: string; store?: string; sort?: string; cursor?: string };

/**
 * The front page is a search box over every store we read. With nothing typed
 * it shows what got cheaper this week; with a term it shows every listed
 * product that holds each word, best match first, one row per store product.
 * Nothing is grouped across stores yet: two rows that look alike are two
 * stores' listings, compared by eye.
 *
 * A GET form rather than a live box: the URL is the search, so it can be
 * shared, and the page renders on the server with the answer already in it.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const category = CATEGORIES.some(([k]) => k === params.category) ? params.category : undefined;
  const sort = params.sort === "unit_price" ? "unit_price" : "relevance";

  return (
    <main className="mx-auto min-h-screen w-full max-w-[880px] px-5 pb-24 pt-8">
      <section className="max-w-[60ch]">
        <h1 className="font-display text-[30px] leading-[1.15] tracking-[-0.01em]">
          Find the shelf price
        </h1>
        <p className="mt-2.5 text-[14px] text-mute">
          Every product we read from Philippine stores, with its price history. The line beside each
          price is its recent steps; a green dot means it just went down.
        </p>
      </section>

      <SearchForm q={q} category={category} sort={sort} />

      {q.length >= 2 ? (
        <Results
          q={q}
          category={category}
          sort={sort}
          store={params.store}
          cursor={params.cursor}
        />
      ) : (
        <Front category={category} />
      )}
    </main>
  );
}

function SearchForm({ q, category, sort }: { q: string; category?: string; sort: string }) {
  return (
    <form action="/" method="get" className="mt-7 flex flex-col gap-4" role="search">
      <label className="flex flex-col gap-1.5">
        <span className="caps">Search</span>
        <span className="flex items-center gap-2.5 border-b-2 border-line text-mute transition-colors focus-within:border-ink focus-within:text-ink">
          <SearchGlyph />
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q}
            autoFocus={!q}
            placeholder="Try alaska evap, tp-link router, or saba sardines"
            className="w-full bg-transparent px-0 py-2.5 font-display text-[22px] text-ink placeholder:font-sans placeholder:text-[14px] placeholder:text-mute focus:outline-none"
          />
        </span>
      </label>
      {category ? <input type="hidden" name="category" value={category} /> : null}
      {sort !== "relevance" ? <input type="hidden" name="sort" value={sort} /> : null}
      <CategoryChips q={q} active={category} sort={sort} />
    </form>
  );
}

function href(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `/?${s}` : "/";
}

function CategoryChips({ q, active, sort }: { q: string; active?: string; sort: string }) {
  const keep = { q: q || undefined, sort: sort !== "relevance" ? sort : undefined };
  return (
    <nav aria-label="Store category" className="flex flex-wrap gap-x-3 gap-y-2">
      <Chip href={href(keep)} on={!active}>
        All stores
      </Chip>
      {CATEGORIES.map(([key, label]) => (
        <Chip key={key} href={href({ ...keep, category: key })} on={active === key}>
          {label}
        </Chip>
      ))}
    </nav>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "border-b pb-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors",
        on ? "border-ink text-ink" : "border-transparent text-mute hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

async function Results({
  q,
  category,
  sort,
  store,
  cursor,
}: {
  q: string;
  category?: string;
  sort: string;
  store?: string;
  cursor?: string;
}) {
  const search = new URLSearchParams({ q, sort, limit: "40" });
  if (category) search.set("category", category);
  if (store) search.set("storeId", store);
  if (cursor) search.set("cursor", cursor);

  let page: ProductSearchResponse;
  try {
    page = await apiGet(`${routes.productSearch}?${search}`, productSearchResponseSchema, 300);
  } catch {
    return (
      <p className="mt-8 text-[13px] text-broken">
        The search did not answer. Try again in a minute.
      </p>
    );
  }

  const srp = page.srp[0];
  const keep = { q, category, store };
  return (
    <section className="mt-8" aria-label="Results">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-mute">
          {page.items.length === 0
            ? `Nothing listed matches “${q}”${category ? ` in ${categoryLabel(category)?.toLowerCase()} stores` : ""}.`
            : `Matches for “${q}”${category ? ` in ${categoryLabel(category)?.toLowerCase()} stores` : ""}`}
        </p>
        <div className="flex gap-3">
          <Chip href={href({ ...keep })} on={sort === "relevance"}>
            Best match
          </Chip>
          <Chip href={href({ ...keep, sort: "unit_price" })} on={sort === "unit_price"}>
            Cheapest per unit
          </Chip>
        </div>
      </div>

      {page.srp.length > 0 ? <SrpRows rows={page.srp} /> : null}

      {page.items.length > 0 ? (
        <ul className="rule mt-3 flex flex-col">
          {collapseListings(page.items).map(({ hit, listings }) => {
            const over = srp ? overSrp(hit, page.srp) : null;
            return (
              <HitRow
                key={`${hit.storeId}:${hit.productKey}`}
                hit={hit}
                listings={listings}
                note={over ? `${formatMoney(over, "PHP")} over the SRP` : undefined}
                noteTone="drift"
              />
            );
          })}
        </ul>
      ) : null}

      {page.nextCursor ? (
        <Link
          href={href({
            ...keep,
            sort: sort !== "relevance" ? sort : undefined,
            cursor: page.nextCursor,
          })}
          className="mt-4 inline-block font-mono text-[11px] text-mute underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
        >
          Next page
        </Link>
      ) : null}
      <p className="mt-4 font-mono text-[10.5px] text-drift">
        Listed means seen in the store&apos;s catalogue in the last 7 days.
      </p>
    </section>
  );
}

/**
 * A store row is over the SRP when it is the same brand at the same size: the
 * SRP's first word (the brand) and its size string are both in the row's
 * name. Loose on purpose; it only marks a row, never hides one.
 */
function overSrp(hit: ProductHit, srp: SrpReference[]): number | null {
  if (!hit.price) return null;
  const name = hit.name.toLowerCase();
  const compact = name.replace(/\s+/g, "");
  for (const s of srp) {
    const brand = s.product.toLowerCase().split(/\s+/)[0] ?? "";
    const size = s.size.toLowerCase().replace(/\s+/g, "");
    if (brand.length > 1 && name.includes(brand) && compact.includes(size)) {
      const over = Math.round((hit.price.amount - s.price) * 100) / 100;
      return over > 0 ? over : null;
    }
  }
  return null;
}

function SrpRows({ rows }: { rows: SrpReference[] }) {
  return (
    <div className="mt-4 border-l-2 border-heal pl-3">
      <p className="caps">DTI suggested retail price</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {rows.map((s) => (
          <li
            key={`${s.product}:${s.size}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 text-[13px]"
          >
            <span>
              {s.product} <span className="text-mute">{s.size}</span>
            </span>
            <span className="font-mono">{formatMoney(s.price, "PHP")}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 font-mono text-[10.5px] text-mute">
        Effective {formatDay(rows[0]!.effective)}.{" "}
        <Link
          href="/this-week#srp"
          className="underline decoration-1 underline-offset-2 hover:text-heal"
        >
          All SRPs
        </Link>
      </p>
    </div>
  );
}

async function Front({ category }: { category?: string }) {
  const search = new URLSearchParams({ limit: "30" });
  if (category) search.set("category", category);
  const drops = await apiGet(`${routes.productDrops}?${search}`, dropsResponseSchema, 300).catch(
    () => null,
  );

  return (
    <>
      <section className="rule mt-10 pt-5" aria-labelledby="drops">
        <h2 id="drops" className="font-display text-[20px] leading-snug">
          Biggest drops this week
        </h2>
        <p className="mt-1 max-w-[64ch] text-[12.5px] text-mute">
          Priced down in the last seven days and at least 10% under the product&apos;s own 30-day
          median. A one-day flicker does not count.
        </p>
        {drops === null ? (
          <p className="mt-4 text-[13px] text-broken">The drops did not load.</p>
        ) : drops.items.length === 0 ? (
          <p className="mt-4 text-[13px] text-mute">
            Nothing qualifies
            {category ? ` in ${categoryLabel(category)?.toLowerCase()} stores` : ""} yet. A product
            needs a few weeks of history before its median means something.
          </p>
        ) : (
          <ul className="rule mt-4 flex flex-col">
            {collapseListings(drops.items).map(({ hit: d, listings }) => (
              <HitRow
                key={`${d.storeId}:${d.productKey}`}
                hit={d}
                listings={listings}
                note={`${Math.round(d.pctBelow * 100)}% under its ${formatMoney(d.median30, d.price?.currency ?? "PHP")} median`}
                noteTone="live"
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rule mt-12 pt-5" aria-labelledby="staples">
        <h2 id="staples" className="font-display text-[20px] leading-snug">
          Start from a staple
        </h2>
        <p className="mt-1 text-[12.5px] text-mute">
          The fifteen the{" "}
          <Link
            href="/basket"
            className="underline decoration-1 underline-offset-2 hover:text-heal"
          >
            basket index
          </Link>{" "}
          prices every day.
        </p>
        <ul className="mt-6 grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-5">
          {PLATE_KEYS.map((key) => (
            <li key={key}>
              <Link
                href={href({ q: PLATE_SEARCH[key].query })}
                className="group flex w-full flex-col items-center gap-1.5"
              >
                <span className="relative block aspect-square w-full max-w-[112px] opacity-[0.34] transition-opacity duration-300 group-hover:opacity-[0.68] group-focus-visible:opacity-[0.68]">
                  <StaplePlate itemKey={key} />
                </span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute transition-colors group-hover:text-ink">
                  {PLATE_SEARCH[key].label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SearchGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.75" cy="6.75" r="4.25" />
      <line x1="10" y1="10" x2="14" y2="14" />
    </svg>
  );
}
