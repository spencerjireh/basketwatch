import type { Metadata } from "next";
import { Archivo, Sometype_Mono } from "next/font/google";
import { Nav } from "@/components/layout/nav";
import "./globals.css";

/**
 * Archivo carries a width axis, so the display role gets expanded widths and
 * the UI role stays normal -- one family, two voices, one download.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
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
  title: "Basketwatch",
  description:
    "What ten grocery staples cost today, priced off the shelf in nineteen stores across two countries.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${sometype.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
