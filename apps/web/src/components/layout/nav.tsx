"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COUNTRY_NAME, countries } from "@basketwatch/contract";
import { CountryLink, useCountry } from "@/components/country/country";
import { cn } from "@/lib/utils";

/**
 * Three surfaces, named for what the reader gets rather than for what the
 * system is: prices, then the catalogue behind them, then the machinery that
 * collected both. "Behind the data" is a door, not a disclaimer -- the fleet and
 * the incidents are the reason to believe the first two pages, so they stay one
 * click away rather than hidden.
 *
 * The country switcher lives here because it scopes all three pages at once:
 * one flip and the basket, the catalogue and the fleet all change world.
 */
const LINKS = [
  { href: "/", label: "Basket" },
  { href: "/prices", label: "Prices" },
  { href: "/behind", label: "Behind the data" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { country, setCountry } = useCountry();

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-baseline gap-x-8 gap-y-2 px-5 py-4">
        <Link href="/" className="font-display text-[19px]">
          basketwatch<span className="text-live">.</span>
        </Link>

        <nav aria-label="Sections" className="flex gap-6">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <CountryLink
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-[13px] transition-colors",
                  active
                    ? "text-ink underline decoration-1 underline-offset-8"
                    : "text-mute hover:text-ink",
                )}
              >
                {link.label}
              </CountryLink>
            );
          })}
        </nav>

        <div className="ml-auto flex gap-5" role="group" aria-label="Country">
          {countries.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === country}
              onClick={() => setCountry(c)}
              className={cn(
                "caps pb-1 transition-colors",
                c === country
                  ? "border-b border-ink text-ink"
                  : "border-b border-transparent text-mute hover:text-ink",
              )}
            >
              {COUNTRY_NAME[c]}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
