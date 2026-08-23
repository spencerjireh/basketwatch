import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { basketRailsResponseSchema, routes, type Rail } from "@basketwatch/contract";
import { apiGet } from "@/lib/api/server";
import { basketSpread, rankStores } from "@/lib/basket/store-totals";
import { formatMoney, spellNumber } from "@/lib/format";

/**
 * The link preview, generated per request so the numbers on it are the
 * numbers on the page. Unfurlers get one country -- the root route sees no
 * query string -- so the card speaks for the US basket, the same default the
 * page opens on.
 *
 * Same segment config pair as page.tsx, for the same reason: `next build`
 * runs with no API container beside it, and a statically optimized OG route
 * would fetch an address nothing is listening on. force-dynamic skips the
 * prerender; fetchCache asks the 60-second fetch cache back.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

export const alt =
  "Basketwatch: today's shelf prices for the staples you actually buy, with the day's basket spread across stores.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Palette literals: the renderer sees no CSS, so the tokens from globals.css
// are carried over by value.
const PAPER = "#faf7f2";
const INK = "#1f1c18";
const MUTE = "#6e675d";
const LINE = "#e6e1d6";
const LIVE = "#1e7a4f";

/**
 * The runner's cwd is the repo root in one Next version of the standalone
 * server and apps/web in the other (server.js may chdir), and `next dev` runs
 * from apps/web -- so the font path is tried from both roots rather than
 * guessed.
 */
async function loadFont(file: string): Promise<ArrayBuffer | null> {
  // Two readFile calls rather than a loop over roots: the tracer only
  // recognises a path it can scope statically, and an opaque one makes it
  // trace the entire source tree into the server bundle.
  let buf: Buffer;
  try {
    buf = await readFile(join(process.cwd(), "apps/web/assets/fonts", file));
  } catch {
    try {
      buf = await readFile(join(process.cwd(), "assets/fonts", file));
    } catch {
      return null;
    }
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const fontsReady = Promise.all([
  loadFont("newsreader-500.ttf"),
  loadFont("sometype-mono-500.ttf"),
]);

type CardData = {
  spread: { low: number; high: number; currency: string } | null;
  stores: number;
  staples: number;
};

async function readBasket(): Promise<CardData | null> {
  try {
    const rails = await apiGet(routes.basketRails, basketRailsResponseSchema, 60);
    const countryRails = rails.filter((rail: Rail) => rail.country === "US");
    if (countryRails.length === 0) return null;
    return {
      spread: basketSpread(rankStores(rails, "US")),
      stores: new Set(countryRails.flatMap((rail: Rail) => rail.pins.map((pin) => pin.storeId)))
        .size,
      staples: countryRails.length,
    };
  } catch {
    // A crawler must get a card, never a 500; the wordmark card below says
    // everything that is true without the API.
    return null;
  }
}

export default async function Image() {
  const [data, [newsreader, sometype]] = await Promise.all([readBasket(), fontsReady]);

  const fonts = [
    newsreader ? { name: "Newsreader", data: newsreader, weight: 500 as const } : null,
    sometype ? { name: "Sometype Mono", data: sometype, weight: 500 as const } : null,
  ].filter((f) => f !== null);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: PAPER,
          color: INK,
          padding: "64px 72px",
          borderTop: `10px solid ${INK}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              backgroundColor: LIVE,
            }}
          />
          <div style={{ fontFamily: "Newsreader", fontSize: "36px" }}>basketwatch</div>
          <div
            style={{
              fontFamily: "Sometype Mono",
              fontSize: "20px",
              color: MUTE,
              marginLeft: "auto",
            }}
          >
            read off the shelf, daily
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "34px" }}>
          <div
            style={{
              fontFamily: "Newsreader",
              fontSize: "64px",
              lineHeight: 1.08,
              letterSpacing: "-0.015em",
              maxWidth: "980px",
            }}
          >
            Today&apos;s shelf prices for the staples you actually buy.
          </div>
          {data?.spread ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: "22px" }}>
              <div style={{ fontFamily: "Sometype Mono", fontSize: "58px" }}>
                {formatMoney(data.spread.low, data.spread.currency)}
                <span style={{ color: MUTE, margin: "0 14px" }}>–</span>
                {formatMoney(data.spread.high, data.spread.currency)}
              </div>
              <div style={{ fontFamily: "Sometype Mono", fontSize: "22px", color: MUTE }}>
                the same basket, cheapest store to dearest
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            borderTop: `1px solid ${LINE}`,
            paddingTop: "26px",
            fontFamily: "Sometype Mono",
            fontSize: "24px",
            color: MUTE,
          }}
        >
          {data
            ? `${spellNumber(data.staples)} staples · ${data.stores} US stores · nobody is cheapest at everything`
            : "staples priced off the shelf in the US and the Philippines"}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length > 0 ? fonts : undefined },
  );
}
