import type { Metadata } from "next";
import { Archivo, Newsreader, Sometype_Mono } from "next/font/google";
import { Nav } from "@/components/layout/nav";
import "./globals.css";

/**
 * Newsreader is the display voice: page titles, staple names, the big totals.
 * The optical-size axis gives it the range from caption to headline in one
 * variable download.
 */
const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

/** Archivo at its normal width is the quiet UI voice. */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

/**
 * The ledger voice: prices, unit prices, timestamps, collector ids, diffs. A
 * price tracker is mostly numbers, and they should look like a record.
 */
const sometype = Sometype_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sometype",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://basketwatch.spencerjireh.com"),
  title: "Basketwatch",
  description:
    "What ten grocery staples cost today, priced off the shelf in nineteen stores across two countries.",
  openGraph: {
    title: "Basketwatch",
    description: "What ten staples cost today, priced off the shelf in two countries.",
    siteName: "Basketwatch",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Basketwatch",
    description: "What ten staples cost today, priced off the shelf in two countries.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${archivo.variable} ${sometype.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
