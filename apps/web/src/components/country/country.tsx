"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { countries, type Country } from "@basketwatch/contract";

/**
 * The one place the selected country lives.
 *
 * There is one country now, so this is a constant rather than a switch. The
 * context stays because every widget that scopes itself -- the terrain, the
 * index strip, the tables, the catalogue search -- already reads
 * `useCountry()`, and a second country would be a change here rather than in
 * each of them.
 */

const COUNTRY: Country = countries[0];

type CountryState = {
  country: Country;
};

const CountryContext = createContext<CountryState>({ country: COUNTRY });

export function CountryProvider({ children }: { children: ReactNode }) {
  return <CountryContext.Provider value={{ country: COUNTRY }}>{children}</CountryContext.Provider>;
}

export function useCountry(): CountryState {
  return useContext(CountryContext);
}
