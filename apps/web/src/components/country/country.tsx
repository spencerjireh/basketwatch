"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { countries, type Country } from "@basketwatch/contract";

/**
 * The one place the selected country lives. The URL is the source of truth --
 * `?country=PH`, with the param omitted for the US default so the common case
 * stays clean -- and this provider is its in-memory mirror. Every widget that
 * used to keep its own country state reads `useCountry()` instead, so the
 * terrain, the index strip, the tables and the fleet board can never disagree.
 */

const DEFAULT_COUNTRY: Country = countries[0];

/**
 * Whether a view is scoped to one country or to the whole fleet.
 *
 * A separate param rather than a third `country` value, which matters: the
 * fleet is machinery and has no country, but the basket and the catalogue do,
 * and `parseCountry` quietly rewrites anything it does not recognise to US. A
 * `country=all` would therefore have to teach every consumer a case it has no
 * meaning for, and would silently drop a PH reader into US prices on the way
 * out. Two params, each answering its own question.
 */
export type Scope = "country" | "all";
const DEFAULT_SCOPE: Scope = "country";

export function parseScope(value: string | null): Scope {
  return value === "all" ? "all" : DEFAULT_SCOPE;
}

type CountryState = {
  country: Country;
  setCountry: (next: Country) => void;
  scope: Scope;
  setScope: (next: Scope) => void;
};

const CountryContext = createContext<CountryState | null>(null);

export function parseCountry(value: string | null): Country {
  return (countries as readonly string[]).includes(value ?? "")
    ? (value as Country)
    : DEFAULT_COUNTRY;
}

export function CountryProvider({ children }: { children: ReactNode }) {
  // Server HTML always renders the default; a deep link to ?country=PH paints
  // US for one frame and flips in CountryUrlSync's effect. That flash is the
  // accepted trade-off -- initialising from `window` here would be a genuine
  // hydration mismatch, not a fix.
  const [country, setCountryState] = useState<Country>(DEFAULT_COUNTRY);

  const setCountry = useCallback((next: Country) => {
    setCountryState(next);
    // Native replaceState, never router.replace: a router navigation issues an
    // RSC request, and the whole point of fetching every country up front is
    // that a flip repaints instantly from data already in hand. Next >=14.1
    // mirrors native history calls into useSearchParams, so CountryUrlSync
    // still observes this write. history.state must be passed through -- Next
    // keeps its router state there and replacing it with null breaks
    // back/forward.
    const url = new URL(window.location.href);
    if (next === DEFAULT_COUNTRY) url.searchParams.delete("country");
    else url.searchParams.set("country", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const [scope, setScopeState] = useState<Scope>(DEFAULT_SCOPE);

  // Deliberately identical to setCountry, for the same reason: building from
  // window.location.href carries every other param through, so flipping scope
  // keeps ?country= and flipping country keeps ?scope=.
  const setScope = useCallback((next: Scope) => {
    setScopeState(next);
    const url = new URL(window.location.href);
    if (next === DEFAULT_SCOPE) url.searchParams.delete("scope");
    else url.searchParams.set("scope", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const value = useMemo(
    () => ({ country, setCountry, scope, setScope }),
    [country, setCountry, scope, setScope],
  );

  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

/**
 * The app's only caller of useSearchParams, kept apart from the provider so
 * that the Suspense boundary the statically prerendered routes demand wraps a
 * null-rendering leaf instead of the whole tree. Covers deep links, Link
 * navigations and back/forward in one effect.
 */
export function CountryUrlSync() {
  const params = useSearchParams();
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error("CountryUrlSync must be used inside a CountryProvider");
  const { country, setCountry, scope, setScope } = ctx;

  // The truth is read from window.location, not from the params hook: our own
  // replaceState updates the location synchronously, but the router mirrors
  // it into useSearchParams a beat later, and an effect trusting the stale
  // mirror would revert the very flip that just happened. The hook's job here
  // is only to fire this effect when the router-visible URL changes -- deep
  // links, Link navigations, back/forward.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const realCountry = parseCountry(search.get("country"));
    if (realCountry !== country) setCountry(realCountry);

    // Reads an absent param too, which is the load-bearing half: "All stores"
    // lives only on /healing, and CountryLink never carries ?scope=, so
    // leaving that page drops the param and this is what resets the memory to
    // match. Without it the fleet would stay unscoped on a page that has no
    // way to say so.
    const realScope = parseScope(search.get("scope"));
    if (realScope !== scope) setScope(realScope);
  }, [params, country, setCountry, scope, setScope]);

  return null;
}

export function useCountry(): CountryState {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error("useCountry must be used inside a CountryProvider");
  return ctx;
}

/**
 * next/link that carries the selected country across pages. Without it a nav
 * click while on PH would land on a bare URL and silently reset to US.
 */
export function CountryLink({ href, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const { country } = useCountry();
  const carried =
    country === DEFAULT_COUNTRY ? href : `${href}${href.includes("?") ? "&" : "?"}country=${country}`;
  return <Link href={carried} {...rest} />;
}
