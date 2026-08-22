"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  productSearchResponseSchema,
  routes,
  type Country,
  type ProductHit,
  type ProductSort,
  type UnitPriceBasis,
} from "@basketwatch/contract";
import { apiGetClient } from "@/lib/api/browser";
import { useCountry } from "@/components/country/country";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const BASIS_LABEL: Record<UnitPriceBasis, string> = {
  per_kg: "per kg",
  per_litre: "per litre",
  per_item: "each",
};

type Status = "loading" | "ready" | "error";

/**
 * Search over the whole catalogue.
 *
 * An empty box is not an empty page. With no term the API returns the catalogue
 * itself, alphabetically, every store mixed together, and typing narrows it. A
 * single character is the one input that goes nowhere: it matches almost every
 * row, no index can serve it, and the API refuses it.
 *
 * Sorted by relevance by default, which is not a hedge. Unit price is only
 * comparable inside one basis: a US search for "rice" matches 261 per-kilo
 * products and five per-item ones, and ranking that union by the bare number
 * fills the first page with mochi rice cakes at forty cents each while the
 * cheapest actual rice sits at a dollar a kilo, unreachable. Pick a unit first,
 * then a price sort means something.
 */
export function ProductSearch() {
  const [q, setQ] = useState("");
  const { country } = useCountry();
  const [basis, setBasis] = useState<UnitPriceBasis | "">("");
  const [sort, setSort] = useState<ProductSort>("relevance");

  const [hits, setHits] = useState<ProductHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);
  /** the term the rendered hits actually came from, which lags what is typed */
  const [applied, setApplied] = useState("");

  const query = useMemo(() => ({ q: q.trim(), country, basis, sort }), [q, country, basis, sort]);

  // Every request carries the token of the query that started it. A slow reply
  // to an older keystroke would otherwise overwrite a newer one's results.
  const token = useRef(0);
  // A second click before the first page lands would append it twice.
  const paging = useRef(false);

  useEffect(() => {
    // One character is held rather than searched: the API refuses it, and
    // blanking the list mid-word to say so is worse than leaving it standing.
    if (query.q.length === 1) return;

    const mine = ++token.current;
    setStatus("loading");
    // The cursor belongs to the results on screen, which this request is about
    // to replace. Paging with it now would seek into a sequence that no longer
    // exists, so the button goes away until the new page names its own cursor.
    setCursor(null);
    // Nothing to debounce when the box is empty -- that is a mount, not typing.
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const page = await apiGetClient(
              `${routes.productSearch}?${params(query)}`,
              productSearchResponseSchema,
            );
            if (token.current !== mine) return;
            setHits(page.items);
            setCursor(page.nextCursor);
            setApplied(query.q);
            setStatus("ready");
            setMessage(null);
          } catch (error) {
            if (token.current !== mine) return;
            setStatus("error");
            setMessage(error instanceof Error ? error.message : "The search did not answer.");
          }
        })();
      },
      query.q ? 220 : 0,
    );

    return () => clearTimeout(timer);
  }, [query]);

  async function loadMore() {
    if (!cursor || paging.current) return;
    paging.current = true;
    const mine = token.current;
    try {
      const page = await apiGetClient(
        `${routes.productSearch}?${params(query, cursor)}`,
        productSearchResponseSchema,
      );
      if (token.current !== mine) return;
      setHits((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      if (token.current !== mine) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The next page did not load.");
    } finally {
      paging.current = false;
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="sr-only">Search products</span>
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search 28,000 products — try rice, milk, coffee"
            className="w-full border-b border-line bg-transparent px-0 py-2.5 font-display text-[22px] text-ink placeholder:font-sans placeholder:text-[14px] placeholder:text-mute focus:border-ink focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Choice
            label="Priced"
            value={basis}
            onChange={(value) => setBasis(value as UnitPriceBasis | "")}
            options={[
              ["", "Any unit"],
              ["per_kg", "per kg"],
              ["per_litre", "per litre"],
              ["per_item", "each"],
            ]}
          />
          <Choice
            label="Sort"
            value={sort}
            onChange={(value) => setSort(value as ProductSort)}
            options={[
              // With nothing typed there is no match to be best, and the API
              // orders the catalogue by name instead. Say what it does.
              ["relevance", query.q ? "Best match" : "A to Z"],
              ["unit_price", "Cheapest per unit"],
            ]}
          />
        </div>
      </div>

      {sort === "unit_price" && basis === "" ? (
        <p className="mt-3 font-mono text-[10.5px] text-drift">
          Sorting mixed units by price compares a price per kilo against a price per piece. Pick a
          unit above to make the ranking mean something.
        </p>
      ) : null}

      {q.trim().length === 1 ? (
        <p className="mt-3 font-mono text-[10.5px] text-drift">
          One letter matches almost everything and nothing can index it. Type another.
        </p>
      ) : null}

      <div className="mt-5">
        {status === "error" ? <Empty tone="broken">{message}</Empty> : null}
        {status !== "error" && hits.length === 0 ? (
          <Empty>
            {status === "loading"
              ? "Reading the catalogue…"
              : applied
                ? `Nothing matches “${applied}” with these filters.`
                : "Nothing in the catalogue matches these filters."}
          </Empty>
        ) : null}

        {hits.length > 0 ? (
          <>
            <ul className="rule flex flex-col">
              {hits.map((hit) => (
                <li
                  key={`${hit.storeId}:${hit.productKey}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{hit.name}</p>
                    <p className="font-mono text-[10.5px] text-mute">
                      {hit.storeName} · {hit.country}
                      {hit.imprecise ? " · approx size" : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {hit.unitPrice && hit.unitPriceBasis ? (
                      <p className="font-mono text-[15px]">
                        {formatMoney(hit.unitPrice.amount, hit.unitPrice.currency)}{" "}
                        <span className="text-[10.5px] text-mute">
                          {BASIS_LABEL[hit.unitPriceBasis]}
                        </span>
                      </p>
                    ) : (
                      <p className="font-mono text-[10.5px] text-mute">no size on the label</p>
                    )}
                    <p className="font-mono text-[10.5px] text-mute">
                      {hit.price ? formatMoney(hit.price.amount, hit.price.currency) : "not priced"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-4 font-mono text-[10.5px] text-drift">
              Every price here came off a store&apos;s own catalogue.
            </p>

            {cursor ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="mt-4 font-mono text-[11px] text-mute underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
              >
                Show more
              </button>
            ) : (
              <p className="mt-4 font-mono text-[10.5px] text-mute">
                {applied
                  ? `${hits.length} match${hits.length === 1 ? "" : "es"}`
                  : `${hits.length} product${hits.length === 1 ? "" : "s"}`}{" "}
                — that is all of them.
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="caps">{label}</span>
      <div className="flex gap-3">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
            className={cn(
              "border-b pb-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors",
              value === optionValue
                ? "border-ink text-ink"
                : "border-transparent text-mute hover:text-ink",
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function Empty({ children, tone }: { children: React.ReactNode; tone?: "broken" }) {
  return (
    <p className={cn("py-8 text-[13px]", tone === "broken" ? "text-broken" : "text-mute")}>
      {children}
    </p>
  );
}

function params(
  query: { q: string; country: Country; basis: string; sort: ProductSort },
  cursor?: string,
): string {
  // Omitted rather than sent empty: absent is the browse case, and `q=` would
  // be a term of length zero.
  const search = new URLSearchParams({ sort: query.sort, limit: "40" });
  if (query.q) search.set("q", query.q);
  search.set("country", query.country);
  if (query.basis) search.set("basis", query.basis);
  if (cursor) search.set("cursor", cursor);
  return search.toString();
}
