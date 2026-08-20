#!/usr/bin/env node
/**
 * Site vetting, browser-first.
 *
 * Replaces the HTTP-only vet-tier1.mjs, which rejected Landers on an empty
 * SPA shell. Scraper Studio drives a real browser, so the only honest test
 * of "does this site expose prices" is a real browser. HTTP is still used,
 * but only for the questions it can actually answer.
 *
 *   Tier 0, free HTTP:  robots.txt on the paths we would scrape, and the
 *                       declared sitemap. The sitemap is the catalogue --
 *                       it tells us whether a public storefront exists and
 *                       hands us real product URLs instead of crawled
 *                       guesses.
 *   Tier 1, browser:    render the homepage, a category page and sample
 *                       staple product pages. Reads prices, product URL
 *                       shape, and any store/login gate. Authoritative for
 *                       PH, where we test from a PH connection.
 *
 * Tier 2 (Unlocker) answers "are we blocked or geo-gated" only -- it does
 * not execute JS, confirmed against Landers on Aug 20. Tier 3 is
 * `brightdata browser --country us`, the only tier that is both
 * geo-targeted and JS-rendering; it is driven separately.
 *
 * A staple only counts when the product title carries a unit token, which
 * is what separates "Arla Full Cream Milk 1L" from "Ensure Gold powder".
 * Every match keeps its sample title and URL, so the counts can be eyeballed
 * rather than trusted, and the survivors' rows seed store_products.
 *
 * Usage: node vet.mjs [--only=Brand] [--tier0-only] [--headed]
 *        node vet.mjs --rescore     recompute verdicts from vet.json, no network
 *
 * Results land in vet.json beside this file, and the seed table in
 * vet-seed.md. Both are committed: they are the evidence behind
 * docs/site-vetting.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const CANDIDATES = [
  { brand: "FreshDirect", country: "US", hosts: ["www.freshdirect.com"] },
  { brand: "Weee!", country: "US", hosts: ["www.sayweee.com"] },
  { brand: "Rite Aid", country: "US", hosts: ["www.riteaid.com"] },
  { brand: "Vitacost", country: "US", hosts: ["www.vitacost.com"] },
  { brand: "iHerb", country: "US", hosts: ["www.iherb.com"] },
  { brand: "Swanson", country: "US", hosts: ["www.swansonvitamins.com"] },
  { brand: "H-E-B", country: "US", hosts: ["www.heb.com"] },
  { brand: "Landers", country: "PH", hosts: ["www.landers.ph"] },
  // No sitemap, so the catalogue cannot seed the probe. These are known
  // product and listing URLs, found by hand, so the render test has
  // something real to look at.
  {
    brand: "Pickaroo",
    country: "PH",
    hosts: ["pickaroo.com"],
    probeUrls: [
      "https://pickaroo.com/little-seed-corner-shop/products/little-seed-corner-shop-katipunan-avenue/product-detail/2712/4-minute-eggs-3-pcs",
    ],
  },
  {
    brand: "Metromart",
    country: "PH",
    hosts: ["www.metromart.com"],
    probeUrls: ["https://www.metromart.com/categories/grocery"],
  },
  { brand: "Watsons PH", country: "PH", hosts: ["www.watsons.com.ph"] },
  { brand: "Southstar Drug", country: "PH", hosts: ["www.southstardrug.com.ph"] },
  { brand: "WalterMart", country: "PH", hosts: ["www.waltermartdelivery.com.ph"] },
  { brand: "S&R", country: "PH", hosts: ["www.snrshopping.com"] },
  { brand: "Robinsons Super", country: "PH", hosts: ["www.robinsonssupermarket.com.ph"] },
  // www.puregold.com.ph serves an incomplete cert chain; the apex works.
  { brand: "Puregold", country: "PH", hosts: ["puregold.com.ph"] },
  { brand: "MerryMart", country: "PH", hosts: ["merrymart.com.ph"] },
  { brand: "All Day", country: "PH", hosts: ["alldaysupermarket.com.ph"] },
  { brand: "Rustan's Fresh", country: "PH", hosts: ["rustansfresh.com"] },

  // Round 2, Aug 20. Two reasons for it. The US list was never expanded
  // past the PRD, leaving one real grocer and three supplement shops; the
  // organizer tip favours niche sites with no prebuilt scrapers, so
  // regional and ethnic grocers are the place to look. And several PH
  // rejects were tested on corporate domains when the storefront lives
  // somewhere else entirely -- the same mistake that nearly lost Landers.
  { brand: "H Mart", country: "US", hosts: ["www.hmart.com"], round: 2 },
  { brand: "99 Ranch", country: "US", hosts: ["www.99ranch.com"], round: 2 },
  { brand: "Wegmans", country: "US", hosts: ["shop.wegmans.com"], round: 2 },
  { brand: "Hy-Vee", country: "US", hosts: ["www.hy-vee.com"], round: 2 },
  { brand: "Sprouts", country: "US", hosts: ["shop.sprouts.com"], round: 2 },
  { brand: "Fresh Thyme", country: "US", hosts: ["www.freshthyme.com"], round: 2 },
  { brand: "Natural Grocers", country: "US", hosts: ["www.naturalgrocers.com"], round: 2 },
  { brand: "Patel Brothers", country: "US", hosts: ["www.patelbros.com"], round: 2 },
  { brand: "Stater Bros", country: "US", hosts: ["www.staterbros.com"], round: 2 },
  { brand: "Save Mart", country: "US", hosts: ["savemart.com"], round: 2 },
  { brand: "Publix", country: "US", hosts: ["www.publix.com"], round: 2 },
  { brand: "Meijer", country: "US", hosts: ["www.meijer.com"], round: 2 },
  { brand: "ShopRite", country: "US", hosts: ["www.shoprite.com"], round: 2 },
  { brand: "Lidl US", country: "US", hosts: ["www.lidl.com"], round: 2 },
  { brand: "Aldi US", country: "US", hosts: ["www.aldi.us"], round: 2 },
  { brand: "GoPuff", country: "US", hosts: ["www.gopuff.com"], round: 2 },

  // PH storefronts on their real domains.
  { brand: "GoCart (Robinsons)", country: "PH", hosts: ["www.gocart.ph"], round: 2 },
  { brand: "SM Markets", country: "PH", hosts: ["smmarkets.ph"], round: 2 },
  { brand: "Alfamart", country: "PH", hosts: ["alfamart.com.ph"], round: 2 },
  { brand: "Shopwise", country: "PH", hosts: ["www.shopwise.com.ph"], round: 2 },
  { brand: "Healthy Options", country: "PH", hosts: ["www.healthyoptions.com.ph"], round: 2 },
  { brand: "Rustan's", country: "PH", hosts: ["www.rustans.com"], round: 2 },
  { brand: "Puregold shop", country: "PH", hosts: ["shop.puregold.com.ph"], round: 2 },
  { brand: "WalterMart alt", country: "PH", hosts: ["waltermart.com.ph"], round: 2 },
];

// The ten PRD staples. `terms` match a product title; `avoid` kills the
// false positives the keyword-only pass produced (Ensure Gold scoring as
// milk, Johnson's baby lotion scoring as rice).
const BASKET = [
  { key: "eggs", terms: ["egg", "eggs"], avoid: ["replacer", "nog", "plant", "salted"] },
  // Variant avoids ("evaporated", "capsule") are not fussiness: a basket
  // index only means something if the same kind of item is priced at every
  // store, and evaporated milk against fresh milk is not a comparison.
  { key: "milk", terms: ["milk"], avoid: ["soap", "lotion", "bath", "shampoo", "ensure", "formula", "supplement", "bread", "candy", "tea", "evaporated", "condensed", "powder", "filled", "chocolate", "goat"] },
  { key: "bread", terms: ["bread", "loaf"], avoid: ["crumb", "crumbs", "mix", "spread"] },
  { key: "rice", terms: ["rice"], avoid: ["lotion", "shampoo", "cracker", "crackers", "paper", "vinegar", "wine", "ball", "milk"] },
  { key: "coffee", terms: ["coffee"], avoid: ["creamer", "mug", "scrub", "soap", "maker", "goat", "milk", "candy", "capsule", "pod"] },
  { key: "sugar", terms: ["sugar"], avoid: ["free", "lip", "scrub", "balm", "cereal", "muesli", "added", "tea", "milk", "syrup"] },
  { key: "chicken", terms: ["chicken"], avoid: ["flavor", "flavour", "cube", "noodle", "pet", "dog", "cat", "ready", "nugget", "sauce", "seasoning", "marinade", "broth", "stock", "soup"] },
  { key: "cooking oil", terms: ["cooking oil", "canola oil", "vegetable oil", "corn oil", "palm oil", "sunflower oil"], avoid: ["essential", "hair", "massage", "diffuser", "butter", "spread", "tuna", "sardines"] },
  { key: "pasta", terms: ["pasta", "spaghetti", "macaroni"], avoid: ["sauce", "strainer", "pot", "microwavable", "meatball", "cheese", "cheddar", "salad"] },
  { key: "banana", terms: ["banana"], avoid: ["chip", "flavor", "flavour", "shampoo", "candle", "cake", "loaf", "wine", "drink", "milk", "bread"] },
];

// Derivative and prepared goods that carry a staple's name without being
// the staple: a banana donut is not a banana.
const PREPARED = ["donut", "turnover", "pastry", "cupcake", "muffin", "pie", "ice cream", "yogurt drink", "juice", "makgeolli", "liqueur", "cocktail", "cereal", "flakes"];

// Phrases where the staple name appears only to deny it.
const NEGATIONS = ["no sugar", "sugar free", "zero sugar", "less sugar", "no milk", "milk free", "egg free", "gluten free"];

// The aisle each staple should come from. A far stronger signal than any
// denylist: a banana in the produce aisle is a banana, a banana in cereal
// is a flavour. Falls back to any food aisle when a store has no match.
const AISLE = {
  eggs: /dairy|chilled|fresh|egg|grocery|breakfast/i,
  milk: /dairy|chilled|milk|fresh/i,
  bread: /baker|bread|grocery/i,
  rice: /cupboard|pantry|grocery|rice|staple|dry/i,
  coffee: /beverage|coffee|drink|cupboard|pantry|grocery/i,
  sugar: /cupboard|pantry|grocery|baking|staple/i,
  chicken: /meat|poultry|seafood|rotisserie|butcher/i,
  "cooking oil": /cupboard|pantry|grocery|cooking|oil|condiment/i,
  pasta: /cupboard|pantry|grocery|pasta|noodle|dry/i,
  banana: /fruit|vegetable|produce|fresh/i,
};

// A real grocery item states how much of it you get.
const UNIT = /(\d+(\.\d+)?\s?(g|kg|ml|l|lt|liter|litre|oz|lb|lbs|ct|pcs|pc|pack|packs|dozen)\b)|(\b\d+s\b)|(\bx\s?\d+\b)/i;

// Staples only count from food aisles. Without this the matcher happily
// scores Cerelac rice-and-veggies as rice and Anmum powder as milk, which
// is the same false-positive class that made a drugstore look stocked.
const FOOD_SEGMENT = /(grocery|food|dairy|chilled|fresh|bakery|bread|meat|poultry|seafood|fruit|vegetable|produce|frozen|beverage|drink|pantry|cupboard|breakfast|snack|rice|noodle|canned|staple)/i;
const NON_FOOD_SEGMENT = /(baby|kids|toys|health|beauty|household|laundry|pet|home|outdoor|apparel|electronics|wellness|vitamin|supplement|personal-care|mother)/i;

const PRODUCT_PATH = /\/(product|products|p|dp|item|ip|shop|product-detail)\//i;
const SLUG_ID = /\/[a-z0-9-]{8,}-\d{3,}(-\d+)?\/?$/i;
const LISTING_PATH = /\/(search|category|categories|collections|c|departments|brand|brands|blog|help|about|account|cart|checkout)(\/|\?|$)/i;

const SEARCH_PATHS = ["/search?q=", "/search?text=", "/search?query=", "/catalogsearch/result/?q=", "/s?k="];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const tier0Only = args.includes("--tier0-only");
// Headed by default: Cloudflare served a 262-byte challenge to headless
// Chrome on Landers while a headed window loaded the same page fine, and a
// false "blocked" verdict is the exact mistake this rewrite exists to stop.
const headless = args.includes("--headless");

const log = (...a) => console.log(...a);

/* ---------------------------------------------------------------- tier 0 */

async function get(url, { timeout = 20000, as = "text" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "*/*" },
    });
    const body = as === "text" ? await res.text() : null;
    return { ok: res.ok, status: res.status, url: res.url, body };
  } catch (err) {
    return { ok: false, status: 0, url, body: null, error: String(err.message || err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function parseRobots(text) {
  const sitemaps = [];
  const disallow = [];
  let starGroup = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "sitemap") sitemaps.push(value);
    else if (key === "user-agent") starGroup = value === "*";
    else if (key === "disallow" && starGroup && value) disallow.push(value);
  }
  return { sitemaps, disallow };
}

function pathAllowed(pathname, disallow) {
  return !disallow.some((rule) => {
    const pattern = rule
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\$$/, "$");
    try {
      return new RegExp("^" + pattern).test(pathname);
    } catch {
      return false;
    }
  });
}

function extractLocs(body) {
  if (body.trimStart().startsWith("<")) {
    return [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  }
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
}

async function collectSitemapUrls(origin, declared) {
  const tried = [];
  const queue = declared.length
    ? [...declared]
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap.txt`];
  const urls = new Set();
  let indexes = 0;

  while (queue.length && urls.size < 60000 && tried.length < 14) {
    const next = queue.shift();
    if (tried.includes(next)) continue;
    tried.push(next);
    const res = await get(next, { timeout: 25000 });
    if (!res.ok || !res.body) continue;
    const locs = extractLocs(res.body);
    const isIndex = /<sitemapindex/i.test(res.body);
    if (isIndex) {
      indexes += 1;
      // Child sitemaps are often per-category; take a spread, not just the head.
      const step = Math.max(1, Math.floor(locs.length / 8));
      for (let i = 0; i < locs.length && queue.length < 12; i += step) queue.push(locs[i]);
    } else {
      for (const loc of locs) urls.add(loc);
    }
  }
  return { urls: [...urls], tried, indexes };
}

function looksLikeProduct(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (LISTING_PATH.test(path)) return false;
  return PRODUCT_PATH.test(path) || SLUG_ID.test(path);
}

function slugWords(url) {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " ").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Whole-word phrase match. Substring matching scored "mixed veggie juice"
 * as eggs and "sparkling rice wine" as rice.
 */
function hasPhrase(words, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^| )${escaped}( |$)`).test(words);
}

/**
 * Avoid terms match word-initially, so "flavor" also kills "flavored" and
 * "flavoured". Match terms stay exact, or "egg" would match "eggplant".
 */
function hasWordStartingWith(words, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^| )${escaped}[a-z]*( |$)`).test(words);
}

function firstSegment(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return "";
  }
}

function matchStaples(urls) {
  const found = {};
  const parsed = urls
    .map((url) => ({ url, words: slugWords(url), segment: firstSegment(url) }))
    .filter((entry) => entry.words);

  for (const item of BASKET) {
    const aisle = AISLE[item.key];
    // Right aisle first, then any other food aisle, and never non-food.
    const ranked = [...parsed].sort((a, b) => {
      const rank = (entry) => {
        if (NON_FOOD_SEGMENT.test(entry.segment)) return 3;
        if (aisle.test(entry.segment)) return 0;
        if (FOOD_SEGMENT.test(entry.segment)) return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });

    const bucket = { withUnit: [], withoutUnit: 0, nonFood: 0, offAisle: 0 };
    for (const entry of ranked) {
      if (bucket.withUnit.length >= 3) break;
      if (!item.terms.some((t) => hasPhrase(entry.words, t))) continue;
      if (NEGATIONS.some((phrase) => hasPhrase(entry.words, phrase))) continue;
      if ([...item.avoid, ...PREPARED].some((a) => hasWordStartingWith(entry.words, a))) continue;
      if (NON_FOOD_SEGMENT.test(entry.segment)) {
        bucket.nonFood += 1;
        continue;
      }
      if (!aisle.test(entry.segment)) bucket.offAisle += 1;
      if (UNIT.test(entry.words)) bucket.withUnit.push(entry.url);
      else bucket.withoutUnit += 1;
    }
    found[item.key] = bucket;
  }
  return found;
}

async function tier0(site) {
  const origin = `https://${site.hosts[0]}`;
  const robotsRes = await get(`${origin}/robots.txt`);
  const robots = robotsRes.ok && robotsRes.body ? parseRobots(robotsRes.body) : { sitemaps: [], disallow: [] };

  const { urls, tried, indexes } = await collectSitemapUrls(origin, robots.sitemaps);
  const productUrls = urls.filter(looksLikeProduct);
  const staples = matchStaples(productUrls.length ? productUrls : urls);
  const covered = Object.entries(staples).filter(([, v]) => v.withUnit.length > 0);

  return {
    origin,
    robots: {
      status: robotsRes.status,
      disallow: robots.disallow.slice(0, 12),
      sitemaps: robots.sitemaps,
      allowsProductPaths: pathAllowed("/product/example-1234", robots.disallow),
      allowsSearch: pathAllowed("/search?q=eggs", robots.disallow),
    },
    sitemap: { tried, indexes, urlCount: urls.length, productUrlCount: productUrls.length },
    catalogue:
      productUrls.length >= 200 ? "full" : productUrls.length >= 20 ? "thin" : urls.length > 0 ? "no-products" : "none",
    staples,
    coveredWithUnit: covered.map(([k]) => k),
    seeds: Object.fromEntries(covered.map(([k, v]) => [k, v.withUnit[0]])),
  };
}

/* ---------------------------------------------------------------- tier 1 */

const PAGE_PROBE = (currency) => {
  const money = currency === "PH" ? "[\\u20b1]|PHP" : "[$]|USD";
  return `(() => {
    const priceRe = new RegExp('(' + ${JSON.stringify(money)} + ')\\\\s?[0-9][0-9,]*(\\\\.[0-9]{2})?', 'g');
    const text = document.body ? document.body.innerText : '';
    const prices = [...new Set(text.match(priceRe) || [])];

    const cssPath = (el) => {
      const parts = [];
      let node = el;
      for (let i = 0; node && node.nodeType === 1 && i < 4; i++) {
        let part = node.tagName.toLowerCase();
        if (node.getAttribute('data-testid')) { parts.unshift(part + '[data-testid="' + node.getAttribute('data-testid') + '"]'); break; }
        if (node.id) { parts.unshift('#' + node.id); break; }
        const cls = (node.className && typeof node.className === 'string' ? node.className : '').trim().split(/\\s+/).filter(Boolean)[0];
        if (cls) part += '.' + cls;
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };

    // The product price is the price nearest the product name. Taking the
    // first price-shaped node on the page instead picked up a promo banner
    // on Vitacost and a hidden zero on Southstar.
    const ancestry = (el) => { const chain = []; for (let n = el; n; n = n.parentElement) chain.push(n); return chain; };
    const heading = document.querySelector('h1');
    const headingChain = heading ? ancestry(heading) : [];
    const distanceToHeading = (el) => {
      if (!headingChain.length) return 0;
      const chain = ancestry(el);
      for (let i = 0; i < chain.length; i++) {
        const j = headingChain.indexOf(chain[i]);
        if (j !== -1) return i + j;
      }
      return 999;
    };

    const candidates = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode() && candidates.length < 80) {
      const el = walker.currentNode;
      if (el.children.length) continue;
      const own = (el.textContent || '').trim();
      if (!own || own.length > 24) continue;
      priceRe.lastIndex = 0;
      if (!priceRe.test(own)) continue;
      const amount = Number(own.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      candidates.push({ el, own, distance: distanceToHeading(el) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const best = candidates[0] || null;
    const priceSelector = best ? cssPath(best.el) : null;
    const priceSample = best ? best.own : null;

    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
    return {
      title: (document.title || '').slice(0, 80),
      h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 90),
      chars: text.length,
      prices: prices.slice(0, 6),
      priceCount: (text.match(priceRe) || []).length,
      priceSelector,
      priceSample,
      jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
      links: hrefs.length,
      gate: /sign in to see|log ?in to see|member(ship)? price|become a member|select (your |a )?(store|branch|location)|enter your delivery|choose a store/i.test(text),
      wall: /access denied|you have been blocked|unusual traffic|verify you are human|just a moment|attention required/i.test(text + ' ' + document.title),
    };
  })()`;
};

async function visit(page, url, currency) {
  let navError = null;
  try {
    await page.goto(url, { waitUntil: "commit", timeout: 30000 });
  } catch (err) {
    navError = String(err.message || err).split("\n")[0].slice(0, 90);
  }
  try {
    await page.waitForLoadState("networkidle", { timeout: 12000 });
  } catch {
    /* SPAs with polling never idle; the waits below cover them */
  }
  await page.waitForTimeout(2500);
  // Slow storefronts paint the shell first and the prices seconds later.
  // Metromart read as "no prices" at 261 characters purely because the
  // probe fired too early.
  try {
    const symbol = currency === "PH" ? "\u20b1" : "$";
    await page.waitForFunction((s) => (document.body?.innerText || "").includes(s), symbol, { timeout: 8000 });
  } catch {
    /* genuinely priceless pages are the finding, not an error */
  }
  try {
    const probe = await page.evaluate(PAGE_PROBE(currency));
    return { url, finalUrl: page.url(), navError, ...probe };
  } catch (err) {
    return { url, navError, evalError: String(err.message || err).slice(0, 90) };
  }
}

// Is the price in the delivered HTML, or only after JS? Complexity signal
// for Studio, never a reject.
async function serverRendered(url, prices) {
  if (!prices.length) return null;
  const res = await get(url, { timeout: 20000 });
  if (!res.ok || !res.body) return null;
  const digits = prices[0].replace(/[^0-9.]/g, "");
  return digits.length >= 2 && res.body.includes(digits);
}

function pickCategoryUrl(t0) {
  const counts = new Map();
  for (const url of t0.sitemap.sample || []) {
    try {
      const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
      if (seg) counts.set(seg, (counts.get(seg) || 0) + 1);
    } catch {
      /* ignore */
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `${t0.origin}/${top[0]}` : null;
}

async function tier1(browser, site, t0) {
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pages = {};

  try {
    pages.home = await visit(page, t0.origin, site.country);

    const category = pickCategoryUrl(t0);
    if (category) pages.category = await visit(page, category, site.country);

    const seedUrls = [
      ...Object.entries(t0.seeds).slice(0, 3),
      ...(site.probeUrls ?? []).map((url) => ["manual seed", url]),
    ];
    pages.products = [];
    for (const [item, url] of seedUrls) {
      const probe = await visit(page, url, site.country);
      probe.item = item;
      probe.serverRendered = await serverRendered(url, probe.prices || []);
      pages.products.push(probe);
    }

    // No catalogue from the sitemap: fall back to the site's own search,
    // rendered, which is how a shopper would find the item anyway.
    if (!seedUrls.length && t0.robots.allowsSearch) {
      for (const path of SEARCH_PATHS) {
        const probe = await visit(page, `${t0.origin}${path}eggs`, site.country);
        if ((probe.prices || []).length || (probe.h1 || "").length) {
          probe.item = "search:eggs";
          pages.search = probe;
          break;
        }
      }
    }
  } finally {
    await context.close();
  }
  return pages;
}

function verdict(site, t0, t1) {
  const probes = [t1.home, t1.category, t1.search, ...(t1.products || [])].filter(Boolean);
  const reachable = probes.some((p) => p.chars > 0 && !p.wall);
  // A challenge page and a dead TLS handshake are different findings: one
  // is worth retrying through Unlocker, the other is just broken.
  const blocked = probes.length > 0 && probes.some((p) => p.wall) && probes.every((p) => p.wall || p.navError);
  const unreachable = probes.length > 0 && probes.every((p) => p.navError && !p.wall);
  const priced = probes.filter((p) => (p.prices || []).length > 0);
  const gated = probes.some((p) => p.gate) && !priced.length;
  const covered = t0.coveredWithUnit.length;

  // No probes at all means the browser pass never reached this site, which is
  // not a finding about the site. Saying UNREACHABLE here would publish a
  // verdict we never earned.
  if (!probes.length) return { verdict: "NOT RUN", why: "tier 1 never ran against this site" };
  if (unreachable) return { verdict: "UNREACHABLE", why: probes.find((p) => p.navError)?.navError ?? "no response" };
  if (blocked) return { verdict: "BLOCKED", why: "every rendered page hit a bot wall from this IP" };
  if (!reachable) return { verdict: "UNREACHABLE", why: probes[0]?.navError || "no response" };
  if (gated) return { verdict: "GATED", why: "prices require a store selection or login" };
  if (!priced.length) return { verdict: "NO PRICES", why: "nothing price-shaped rendered on any page" };

  // No sitemap is a sourcing problem, not a reject. The store is real and
  // priced; the per-item URL list has to come from search or a category
  // crawl instead, which costs us build time, not viability.
  if (t0.catalogue === "none" || t0.catalogue === "no-products") {
    return {
      verdict: "PASS (no sitemap)",
      why: "prices render, but the URL list must come from search or a category crawl",
    };
  }

  const server = (t1.products || []).some((p) => p.serverRendered === true);
  const label = covered >= 7 ? "PASS" : covered >= 3 ? "PASS (partial basket)" : "PASS (no staples)";
  return {
    verdict: label,
    why: `${covered}/10 staples with unit sizes, prices ${server ? "in HTML" : "rendered client-side"}`,
  };
}

/* ------------------------------------------------------------------ main */

/** Recompute verdicts from the stored run, no network. */
async function rescore() {
  const path = new URL("./vet.json", import.meta.url);
  const results = JSON.parse(await readFile(path, "utf8"));
  for (const r of results) {
    Object.assign(r, verdict(r, r.t0, r.t1 ?? {}));
    console.log(`  ${r.brand.padEnd(18)} ${r.verdict.padEnd(22)} ${r.why}`);
  }
  await writeFile(path, JSON.stringify(results, null, 2));
  await writeSeeds(results);
}

async function main() {
  if (args.includes("--rescore")) return rescore();

  const round = args.find((a) => a.startsWith("--round="))?.split("=")[1];
  let targets = CANDIDATES;
  if (only) targets = targets.filter((c) => c.brand.toLowerCase().includes(only.toLowerCase()));
  if (round) targets = targets.filter((c) => String(c.round ?? 1) === round);
  const partial = targets.length < CANDIDATES.length;
  const results = [];

  log(`tier 0: robots and sitemap over ${targets.length} candidates`);
  for (const site of targets) {
    const t0 = await tier0(site);
    t0.sitemap.sample = [];
    log(
      `  ${site.brand.padEnd(18)} catalogue=${t0.catalogue.padEnd(12)} products=${String(t0.sitemap.productUrlCount).padStart(6)} staples=${t0.coveredWithUnit.length}/10`,
    );
    results.push({ ...site, t0 });
  }

  // Keep a URL sample per site for category discovery in tier 1.
  for (const r of results) {
    const seeds = Object.values(r.t0.seeds);
    r.t0.sitemap.sample = seeds.slice(0, 50);
  }

  if (!tier0Only) {
    log(`\ntier 1: browser render`);
    const browser = await chromium.launch({
      channel: "chrome",
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    try {
      for (const r of results) {
        const t1 = await tier1(browser, r, r.t0);
        r.t1 = t1;
        Object.assign(r, verdict(r, r.t0, t1));
        log(`  ${r.brand.padEnd(18)} ${r.verdict.padEnd(22)} ${r.why}`);
      }
    } finally {
      await browser.close();
    }
  }

  const out = new URL("./vet.json", import.meta.url);

  // A targeted re-run updates its own sites and leaves the rest alone.
  // Writing only the filtered results would silently discard a full pass
  // that takes fifteen minutes to reproduce.
  let merged = results;
  if (partial) {
    try {
      const prior = JSON.parse(await readFile(out, "utf8"));
      const byBrand = new Map(prior.map((r) => [r.brand, r]));
      for (const r of results) byBrand.set(r.brand, r);
      merged = [...byBrand.values()];
      log(`\nmerged ${results.length} of ${merged.length} sites into the existing run`);
    } catch {
      /* no prior run to merge into */
    }
  }

  await writeFile(out, JSON.stringify(merged, null, 2));
  log(`wrote ${out.pathname}`);
  await writeSeeds(merged);
}

async function writeSeeds(results) {
  const seedRows = [];
  for (const r of results) {
    if (!r.verdict?.startsWith("PASS")) continue;
    for (const p of r.t1?.products || []) {
      if (!(p.prices || []).length) continue;
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").replace(/\|/g, "-").trim();
      // priceSample is the price beside the product name; prices[0] is
      // whatever matched first anywhere on the page.
      const price = clean(p.priceSample || p.prices[0]);
      seedRows.push(
        `| ${r.brand} | ${r.country} | ${p.item} | ${clean(p.h1)} | ${price} | ${p.serverRendered ? "HTML" : "rendered"} | \`${clean(p.priceSelector)}\` | ${p.url} |`,
      );
    }
  }
  const seedDoc = [
    "# Scraper seed rows",
    "",
    "Generated by `scripts/vet.mjs`. One row per staple that rendered a price.",
    "",
    "| Store | Country | Item | Product title | Price seen | Price source | Selector | URL |",
    "|---|---|---|---|---|---|---|---|",
    ...seedRows,
    "",
  ].join("\n");
  const seedOut = new URL("./vet-seed.md", import.meta.url);
  await writeFile(seedOut, seedDoc);
  log(`wrote ${seedOut.pathname} (${seedRows.length} rows)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
