/**
 * Sitemap parsing and product-URL scoring, ported from vet.py.
 *
 * A sitemap lists everything a site publishes, most of which is not a product.
 * With one fetch per product page, probing an editorial URL is a wasted fetch
 * against the ceiling -- so URLs are filtered before any of them is fetched.
 *
 * Pure and IO-free: the caller supplies the XML.
 */

/** Returns the page URLs and, separately, nested sitemaps still to fetch. */
export function parseSitemap(text: string): { pages: string[]; sitemaps: string[] } {
  const stripped = text.trimStart();
  if (stripped.startsWith("<")) {
    const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
    return /<sitemapindex/i.test(text) ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
  }
  // Some stores publish a plain-text sitemap, one URL per line.
  const pages = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"));
  return { pages, sitemaps: [] };
}

/** Path segments that mean a URL is editorial or navigational, never a product. */
const NON_PRODUCT_PATHS = new Set([
  "recipe", "recipes", "healthy-living", "article", "articles", "blog", "news",
  "story", "stories", "guide", "guides", "event", "events", "career", "careers",
  "about", "contact", "faq", "help", "support", "policy", "privacy", "terms",
  "store-locator", "stores", "locations", "branches", "weekly-ad", "coupon",
  "coupons", "gift-card", "giftcard", "category", "categories", "collections",
  "container", "brand", "brands", "tag", "tags", "search", "account", "login",
  "cart", "checkout", "sitemap", "page", "pages", "author", "press", "media",
  "community", "recall", "recalls", "spotlight", "promo", "promos", "sale",
  "deals", "flyer", "circular", "info", "landing", "home-page", "homepage",
  "assets", "static", "uploads", "banners", "inspiration", "ideas", "learn",
  "discover", "explore", "meal", "menu",
]);

/**
 * Words that make a slug editorial wherever they appear, unlike softer terms
 * such as "sale" or "info" which can show up inside a real product name.
 */
const EDITORIAL_WORDS = new Set([
  "recipe", "recipes", "article", "articles", "blog", "news", "guide", "guides",
  "inspiration", "ideas", "story", "stories",
]);

/** Grocery Outlet once scored as server-rendered off a homepage banner image. */
const RE_ASSET_SLUG = /banner|logo|hero|thumbnail|placeholder|sprite|favicon/i;
const RE_FILE_EXT = /\.(jpg|jpeg|png|gif|pdf|css|js|webp|svg|xml|zip)$/;
const RE_UNIT = /\b\d+(?:\.\d+)?\s?-?\s?(?:oz|lb|lbs|ml|l|g|kg|ct|pk|pack|packs|dozen|count|gal|qt|pcs|pc)\b/;

/** How product-like a URL looks. Negative means: do not spend a fetch on it. */
export function productScore(url: string): number {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return -100;
  }
  if (!path || path === "/") return -100;
  if (RE_FILE_EXT.test(path)) return -100;

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return -100;

  // Words inside a segment, not the whole segment: The Fresh Market files
  // editorial under "/inspiration/recipe-and-ideas/", which whole-segment
  // equality let straight through.
  const words = (segment: string) => new Set(segment.split(/[^a-z0-9]+/).filter(Boolean));
  const parents = segments.slice(0, -1);
  if (parents.some((s) => NON_PRODUCT_PATHS.has(s) || intersects(words(s), NON_PRODUCT_PATHS))) {
    return -100;
  }

  // The last segment is the product slug, so only unambiguous editorial words
  // disqualify it -- a staple can legitimately be called "sale-rice-5kg".
  const slug = segments.at(-1)!;
  if (NON_PRODUCT_PATHS.has(slug) || intersects(words(slug), EDITORIAL_WORDS)) return -100;
  if (RE_ASSET_SLUG.test(slug)) return -100;

  let score = 0;
  if (/\/(p|product|products|item|shop)\//.test(path)) score += 3;
  if (RE_UNIT.test(slug)) score += 2;
  if (slug.split("-").length >= 3) score += 1;
  if (/\d/.test(slug)) score += 1;
  return score;
}

/** Most product-like first, so a page ceiling spends its budget well. */
export function rankProductUrls(urls: string[]): string[] {
  return urls
    .map((url) => ({ url, score: productScore(url) }))
    .filter((u) => u.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((u) => u.url);
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}
