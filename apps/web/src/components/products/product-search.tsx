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
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const BASIS_LABEL: Record<UnitPriceBasis, string> = {
  per_kg: "per kg",
  per_litre: "per litre",
  per_item: "each",
};

type Status = "idle" | "loading" | "ready" | "error";

/**
 * Search over the whole catalogue.
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
  const [country, setCountry] = useState<Country | "">("");
  const [basis, setBasis] = useState<UnitPriceBasis | "">("");
  const [sort, setSort] = useState<ProductSort>("relevance");

  const [hits, setHits] = useState<ProductHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const query = useMemo(
    () => ({ q: q.trim(), country, basis, sort }),
    [q, country, basis, sort],
  );

  // Every request carries the token of the query that started it. A slow reply
  // to an older keystroke would otherwise overwrite a newer one's results.
  const token = useRef(0);

  useEffect(() => {
    if (query.q.length < 2) {
      setHits([]);
      setCursor(null);
      setStatus("idle");
      return;
    }

    const mine = ++token.current;
    setStatus("loading");
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await apiGetClient(
            `${routes.productSearch}?${params(query)}`,
            productSearchResponseSchema,
          );
          if (token.current !== mine) return;
          setHits(page.items);
          setCursor(page.nextCursor);
          setStatus("ready");
          setMessage(null);
        } catch (error) {
          if (token.current !== mine) return;
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "The search did not answer.");
        }
      })();
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  async function loadMore() {
    if (!cursor) return;
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
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The next page did not load.");
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
            className="w-full rounded-[6px] border border-line bg-rail px-3.5 py-2.5 text-[14px] text-chalk placeholder:text-mute focus:border-heal/50 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Choice
            label="Country"
            value={country}
            onChange={(value) => setCountry(value as Country | "")}
            options={[
              ["", "Both"],
              ["US", "US"],
              ["PH", "PH"],
            ]}
          />
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
              ["relevance", "Best match"],
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

      <div className="mt-5">
        {status === "idle" ? (
          <Empty>Type at least two characters. Every price here came off a store&apos;s own catalogue.</Empty>
        ) : null}
        {status === "error" ? <Empty tone="broken">{message}</Empty> : null}
        {status !== "idle" && status !== "error" && hits.length === 0 ? (
          <Empty>
            {status === "loading" ? "Searching…" : `Nothing matches “${query.q}” with these filters.`}
          </Empty>
        ) : null}

        {hits.length > 0 ? (
          <>
            <ul className="flex flex-col gap-1.5">
              {hits.map((hit) => (
                <li
                  key={`${hit.storeId}:${hit.productKey}`}
                  className="shelf-edge flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-l-line px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{hit.name}</p>
                    <p className="font-mono text-[10.5px] text-mute">
                      {hit.storeName} · {hit.country}
                      {hit.imprecise ? " · approx size" : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[13px]">
                      {hit.price ? formatMoney(hit.price.amount, hit.price.currency) : "not priced"}
                    </p>
                    {hit.unitPrice && hit.unitPriceBasis ? (
                      <p className="font-mono text-[10.5px] text-live">
                        {formatMoney(hit.unitPrice.amount, hit.unitPrice.currency)}{" "}
                        {BASIS_LABEL[hit.unitPriceBasis]}
                      </p>
                    ) : (
                      <p className="font-mono text-[10.5px] text-mute">no size on the label</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {cursor ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="mt-4 rounded border border-line px-3 py-1.5 font-mono text-[11px] text-mute transition-colors hover:border-heal/40 hover:text-heal"
              >
                Show more
              </button>
            ) : (
              <p className="mt-4 font-mono text-[10.5px] text-mute">
                {hits.length} match{hits.length === 1 ? "" : "es"} — that is all of them.
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
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">{label}</span>
      <div className="flex gap-1">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
            className={cn(
              "rounded border px-2 py-0.5 font-mono text-[10.5px] transition-colors",
              value === optionValue
                ? "border-heal/40 bg-heal/10 text-heal"
                : "border-line text-mute hover:text-chalk",
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
  query: { q: string; country: string; basis: string; sort: ProductSort },
  cursor?: string,
): string {
  const search = new URLSearchParams({ q: query.q, sort: query.sort, limit: "40" });
  if (query.country) search.set("country", query.country);
  if (query.basis) search.set("basis", query.basis);
  if (cursor) search.set("cursor", cursor);
  return search.toString();
}
