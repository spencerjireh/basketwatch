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
import { PLATE_KEYS, PLATE_SEARCH } from "@/lib/plates";
import { StaplePlate } from "@/components/plates/staple-plate";
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
        {/* The field is the page's one instruction, and a bare underline under
            a serif headline reads as more headline. So: name it in the label
            voice, put a glyph on the rule, and make that rule the heaviest
            line on the page -- every other division here is a hairline. */}
        <label className="flex flex-col gap-1.5">
          <span className="caps">Search</span>
          <span className="flex items-center gap-2.5 border-b-2 border-line text-mute transition-colors focus-within:border-ink focus-within:text-ink">
            <SearchGlyph />
            <input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              // The one control the page exists for. A caret already in it
              // says "type" more plainly than any copy above it can.
              autoFocus
              placeholder="Try rice, milk, or olive oil"
              className="w-full bg-transparent px-0 py-2.5 font-display text-[22px] text-ink placeholder:font-sans placeholder:text-[14px] placeholder:text-mute focus:outline-none"
            />
          </span>
        </label>

        {/* Two groups, and they do different jobs: Priced narrows what is in
            the list, Sort only reorders it. Pushing Sort to the far edge is
            what separates them -- until the row wraps, where a lone
            right-aligned group would read as detached instead. */}
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
            className="sm:ml-auto"
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

      {/*
       * With nothing typed the list below is the whole catalogue, alphabetically,
       * which is a fine place to end up and a poor place to start. The fifteen
       * staples are the shortcut in for anyone who does not already know what
       * they are looking for, and they are the same fifteen the front page prices.
       * They go the moment a term is typed -- keyed off what is in the box, not
       * off what the rendered hits came from, so they leave on the keystroke
       * rather than on the reply.
       */}
      {q.trim() === "" ? (
        <div className="rule mt-8 pt-6">
          <p className="text-[13px] text-mute">Start from a staple, or scroll the catalogue.</p>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-5">
            {PLATE_KEYS.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setQ(PLATE_SEARCH[key].query)}
                  className="group flex w-full flex-col items-center gap-1.5"
                >
                  <span className="relative block aspect-square w-full max-w-[132px] opacity-[0.34] transition-opacity duration-300 group-hover:opacity-[0.68] group-focus-visible:opacity-[0.68]">
                    <StaplePlate itemKey={key} />
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute transition-colors group-hover:text-ink group-focus-visible:text-ink">
                    {PLATE_SEARCH[key].label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
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

/**
 * The lens, drawn at the hairline weight the rest of the page rules with
 * rather than as a filled icon. Decorative: the label beside it already
 * names the field.
 */
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

function Choice({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
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
