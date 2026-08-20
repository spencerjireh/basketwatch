/**
 * Reading a product off a page, structured sources first.
 *
 * Ported from basket.py's extract_product. The order is the confidence order:
 * JSON-LD is a publisher's own machine-readable claim, microdata and OpenGraph
 * are weaker versions of the same, and the bare-HTML fallback exists because
 * Kesar Grocery and MerryMart Wholesale hold nearly 12,000 products between
 * them and expose no structured data at all.
 *
 * Pure and IO-free: the caller supplies the HTML.
 */

export type ExtractedProduct = {
  name: string;
  price: number;
  currency: string | null;
  via: "json-ld" | "microdata" | "og" | "bare-html";
};

const RE_LD_BLOCK = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const RE_MICRO_NAME = /itemprop\s*=\s*["']name["'][^>]*content\s*=\s*["']([^"']{3,120})/i;
const RE_MICRO_PRICE = /itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([\d.,]+)/i;
const RE_OG_TITLE = /property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']{3,120})/i;
const RE_OG_PRICE = /property\s*=\s*["'](?:og:)?product:price:amount["'][^>]*content\s*=\s*["']([\d.,]+)/i;
const RE_H1 = /<h1[^>]*>([\s\S]{3,150}?)<\/h1>/i;
const RE_PRICE_CLASS = /class\s*=\s*["'][^"']*price[^"']*["'][^>]*>\s*[^\d<]{0,8}([\d,]+(?:\.\d{1,2})?)/i;

export function extractProduct(html: string): ExtractedProduct | null {
  if (!html) return null;

  for (const match of html.matchAll(RE_LD_BLOCK)) {
    const found = fromJsonLd(match[1] ?? "");
    if (found) return found;
  }

  const microName = RE_MICRO_NAME.exec(html);
  const microPrice = RE_MICRO_PRICE.exec(html);
  if (microName && microPrice) {
    const price = toNumber(microPrice[1]);
    if (price !== null) {
      return { name: microName[1]!.slice(0, 150), price, currency: null, via: "microdata" };
    }
  }

  const ogTitle = RE_OG_TITLE.exec(html);
  const ogPrice = RE_OG_PRICE.exec(html);
  if (ogTitle && ogPrice) {
    const price = toNumber(ogPrice[1]);
    if (price !== null) {
      return { name: ogTitle[1]!.slice(0, 150), price, currency: null, via: "og" };
    }
  }

  const heading = RE_H1.exec(html);
  const priced = RE_PRICE_CLASS.exec(html);
  if (heading && priced) {
    const price = toNumber(priced[1]);
    const name = stripTags(heading[1] ?? "");
    if (price !== null && name) return { name: name.slice(0, 150), price, currency: null, via: "bare-html" };
  }

  return null;
}

function fromJsonLd(block: string): ExtractedProduct | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.trim());
  } catch {
    return null;
  }

  for (const node of walk(parsed)) {
    const types = asArray(node["@type"]);
    if (!types.some((t) => t === "Product" || t === "IndividualProduct")) continue;

    const name = node.name;
    const offersRaw = node.offers;
    const offers = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
    if (typeof name !== "string" || typeof offers !== "object" || offers === null) continue;

    const offer = offers as Record<string, unknown>;
    const price = toNumber(offer.price ?? offer.lowPrice);
    if (price === null) continue;

    return {
      name: name.slice(0, 150),
      price,
      currency: typeof offer.priceCurrency === "string" ? offer.priceCurrency : null,
      via: "json-ld",
    };
  }
  return null;
}

/** Every object in a JSON-LD document: publishers nest Product under @graph and arrays. */
function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  yield node as Record<string, unknown>;
  for (const value of Object.values(node)) yield* walk(value);
}

function asArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
