import { createServer } from "node:http";

/**
 * Parker's Pantry: a disclosed fake grocery store with two storefronts
 * (US and PH) whose markup can be mutated on demand to break scrapers in
 * a controlled, reproducible way. The heal-demo target and the comparison
 * view's insurance policy.
 *
 * Layout A: prices in .price spans with data-sku attributes.
 * Layout B: renamed classes, price split into whole/cents nested spans,
 *           product key moved into a data-testid attribute.
 *
 * Prices drift deterministically: a per-(store, product, day) seeded walk
 * of at most 1.5% per day from a fixed launch date. The same request gives
 * the same price all day; the walk needs no storage and survives restarts.
 *
 * Toggle: POST /admin/layout {"store":"us"|"ph","layout":"a"|"b"} with
 * X-Admin-Token header, or set LAYOUT at boot for both storefronts.
 * Disclosed as a test rig in the hackathon submission.
 */

const BASE_URL = process.env.PUBLIC_BASE_URL ?? "https://pantry.spencerjireh.com";

/** Names embed a parseable size: unit-price math reads it off the page. */
const CATALOG = [
  { key: "eggs-12", name: "Farm Fresh Large Eggs 12 ct", size: "12 ct", usd: 4.49, php: 260 },
  { key: "milk-1g", name: "Whole Milk 1 gal", size: "1 gal", usd: 3.89, php: 340 },
  { key: "bread-loaf", name: "Classic White Bread 20 oz", size: "20 oz", usd: 2.79, php: 95 },
  { key: "rice-5lb", name: "Long Grain White Rice 5 lb", size: "5 lb", usd: 6.99, php: 310 },
  { key: "coffee-12oz", name: "House Blend Ground Coffee 12 oz", size: "12 oz", usd: 9.49, php: 480 },
  { key: "sugar-4lb", name: "Granulated Sugar 4 lb", size: "4 lb", usd: 3.59, php: 210 },
  { key: "chicken-lb", name: "Chicken Breast 1 lb", size: "1 lb", usd: 4.29, php: 200 },
  { key: "oil-48oz", name: "Vegetable Oil 48 fl oz", size: "48 fl oz", usd: 5.19, php: 290 },
  { key: "pasta-1lb", name: "Spaghetti Pasta 1 lb", size: "1 lb", usd: 1.89, php: 105 },
  { key: "bananas-lb", name: "Bananas 1 lb", size: "1 lb", usd: 0.69, php: 40 },
];

/** `lite` is the awning's pale stripe: white would vanish against the page. */
const STORES = {
  us: { label: "US Store", accent: "#1d4ed8", lite: "#dbe4fa", flag: "US" },
  ph: { label: "PH Store", accent: "#b91c1c", lite: "#f8dfdc", flag: "PH" },
};

const layouts = {
  us: (process.env.LAYOUT ?? "a").toLowerCase() === "b" ? "b" : "a",
  ph: (process.env.LAYOUT ?? "a").toLowerCase() === "b" ? "b" : "a",
};

/** Drift epoch. Day 0 serves the base prices exactly. */
const LAUNCH = Date.parse("2026-08-20T00:00:00Z");
const DAY_MS = 86_400_000;

const fnv1a = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const mulberry32 = (seed) => {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const priceFor = (store, product) => {
  const base = store === "us" ? product.usd : product.php;
  const days = Math.max(0, Math.floor((Date.now() - LAUNCH) / DAY_MS));
  let price = base;
  for (let d = 1; d <= days; d++) {
    const r = mulberry32(fnv1a(`${store}:${product.key}:${d}`));
    price *= 1 + (r * 2 - 1) * 0.015;
  }
  return store === "us" ? Math.round(price * 100) / 100 : Math.round(price);
};

const money = (store, value) =>
  store === "us" ? `$${value.toFixed(2)}` : `₱${value.toFixed(2)}`;

const productUrl = (store, key) => `${BASE_URL}/${store}/products/${key}`;

const cardA = (store, p, price) => `
      <a class="product-card" href="${productUrl(store, p.key)}">
        <h3 class="product-name">${p.name}</h3>
        <span class="price" data-sku="${p.key}">${money(store, price)}</span>
        <span class="size">${p.size}</span>
        <span class="stock in-stock">In stock</span>
      </a>`;

const cardB = (store, p, price) => {
  const [whole, cents] = price.toFixed(2).split(".");
  const symbol = store === "us" ? "$" : "₱";
  return `
      <a class="item-tile" href="${productUrl(store, p.key)}" data-testid="sku-${p.key}">
        <h3 class="item-title">${p.name}</h3>
        <div class="item-cost" data-testid="product-price"><span class="cost-currency">${symbol}</span><span class="cost-whole">${whole}</span><span class="cost-cents">${cents}</span></div>
        <div class="item-meta"><span class="item-pack">${p.size}</span><span class="availability" data-state="available">Available</span></div>
      </a>`;
};

/**
 * Look and feel only -- nothing below is scraper-facing. The card markup in
 * cardA/cardB above is the scrape contract and stays frozen; this stylesheet
 * dresses that fixed DOM as a small family grocer. The one bold element is
 * the striped awning (country accent + white, scalloped edge); everything
 * else stays quiet around it.
 *
 * The Scrape-Verse nod is printed, not webbed: the wordmark carries a hint
 * of misregistered red/blue plates, the masthead a faint halftone dot
 * field, and the shelf tags a comic-sticker ink line -- all readings that a
 * grocer's weekly circular and a comic page happen to share.
 */
const css = (accent, lite) => `
  :root { --accent: ${accent}; --lite: ${lite}; --ink: #26221c; --milk: #fdfcf8; --card: #fffefb; --crate: #e6dfd2; --tag: #ffd23f; --leaf: #2e7d4f; --muted: #7d746a; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Public Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--milk); color: var(--ink); }
  a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
  .topbar { background: var(--ink); color: #f4efe6; font-size: 0.78rem; padding: 0.45rem 1.5rem; display: flex; justify-content: space-between; gap: 0.6rem 1rem; flex-wrap: wrap; }
  .topbar a { color: #f4efe6; text-decoration: none; margin-left: 1.1rem; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; font-size: 0.72rem; }
  .topbar a[aria-current="true"] { color: var(--tag); }
  .topbar a:hover { text-decoration: underline; }
  .masthead { padding: 2.1rem 1.5rem 1.6rem; text-align: center; background-image: radial-gradient(${accent}12 1.2px, transparent 1.3px); background-size: 13px 13px; }
  .brand { font-family: Bevan, Georgia, 'Times New Roman', serif; font-size: clamp(1.9rem, 5vw, 2.6rem); line-height: 1.1; text-shadow: -2px 1px 0 rgba(29,78,216,0.30), 2px -1px 0 rgba(185,28,28,0.30); }
  .brand a { color: inherit; text-decoration: none; }
  .tagline { margin-top: 0.55rem; color: var(--muted); font-size: 0.92rem; }
  .storefront-label { display: inline-block; margin-top: 0.8rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); border: 1px solid currentColor; padding: 0.22rem 0.7rem; border-radius: 999px; }
  .awning { height: 30px; border-top: 4px solid var(--accent); background: linear-gradient(rgba(38,34,28,0.10), rgba(38,34,28,0) 55%), repeating-linear-gradient(90deg, var(--accent) 0 42px, var(--lite) 42px 84px); position: relative; margin-bottom: 30px; }
  .awning::after { content: ""; position: absolute; top: 100%; left: 0; right: 0; height: 15px;
    background:
      radial-gradient(21px 15px at 21px 0, var(--accent) 97%, transparent 100%) 0 0 / 84px 15px repeat-x,
      radial-gradient(21px 15px at 21px 0, var(--lite) 97%, transparent 100%) 42px 0 / 84px 15px repeat-x; }
  main { max-width: 1020px; margin: 0 auto; padding: 0.5rem 1.5rem 3rem; }
  .aisle-sign { display: flex; align-items: center; gap: 1rem; margin: 1.2rem 0 1.6rem; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
  .aisle-sign::before, .aisle-sign::after { content: ""; flex: 1; border-top: 1px solid var(--crate); }
  .product-grid, .item-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 1.1rem; }
  .product-card, .item-tile { background: var(--card); border: 1px solid var(--crate); border-radius: 10px; padding: 1.05rem 1.05rem 0.95rem; text-decoration: none; color: inherit; box-shadow: 0 1px 2px rgba(38,34,28,0.05); transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease; }
  .product-card:hover, .item-tile:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: 0 6px 16px rgba(38,34,28,0.10); }
  .product-card { display: grid; grid-template-columns: 1fr auto; row-gap: 0.6rem; align-items: end; }
  .item-tile { display: flex; flex-direction: column; gap: 0.6rem; }
  .product-name, .item-title { font-size: 0.92rem; font-weight: 600; line-height: 1.35; min-height: 2.7em; }
  .product-name { grid-column: 1 / -1; }
  .price, .item-cost { background: var(--tag); color: var(--ink); font-weight: 800; font-size: 1.12rem; padding: 0.28rem 0.6rem 0.24rem; border-radius: 3px; border: 1.5px solid var(--ink); box-shadow: 2px 2px 0 var(--ink); }
  .price { grid-column: 1 / -1; justify-self: start; }
  .item-cost { align-self: flex-start; }
  .cost-currency, .cost-cents { font-size: 0.72rem; font-weight: 700; vertical-align: 0.45em; }
  .cost-currency { margin-right: 1px; }
  .cost-whole { font-size: 1.2rem; }
  .size, .item-pack { color: var(--muted); font-size: 0.78rem; }
  .stock, .availability { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leaf); }
  .stock { justify-self: end; }
  .item-meta { display: flex; justify-content: space-between; align-items: baseline; }
  .breadcrumb { font-size: 0.8rem; color: var(--muted); margin: 0.2rem 0 1.4rem; }
  .breadcrumb a { color: var(--accent); text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .detail-wrap { max-width: 460px; }
  .product-card.detail, .item-tile.detail { padding: 1.6rem; }
  .detail .price, .detail .item-cost { font-size: 1.5rem; padding: 0.4rem 0.8rem 0.35rem; }
  .detail .cost-whole { font-size: 1.6rem; }
  .detail .cost-currency, .detail .cost-cents { font-size: 0.95rem; }
  .doors { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.4rem; margin-top: 1.6rem; }
  .door { display: block; background: var(--card); border: 1px solid var(--crate); border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; box-shadow: 0 1px 2px rgba(38,34,28,0.05); transition: transform 120ms ease, box-shadow 120ms ease; }
  .door:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(38,34,28,0.12); }
  .door-stripe { display: block; height: 18px; border-top: 3px solid var(--door-accent); background: repeating-linear-gradient(90deg, var(--door-accent) 0 26px, var(--door-lite) 26px 52px); }
  .door-us { --door-accent: #1d4ed8; --door-lite: #dbe4fa; }
  .door-ph { --door-accent: #b91c1c; --door-lite: #f8dfdc; }
  .door-body { display: block; padding: 1.2rem 1.3rem 1.35rem; }
  .door-title { display: block; font-weight: 700; font-size: 1.05rem; }
  .door-note { display: block; color: var(--muted); font-size: 0.85rem; margin-top: 0.35rem; line-height: 1.5; }
  footer { border-top: 1px solid var(--crate); margin-top: 3rem; padding: 1.4rem 1.5rem 2.2rem; color: var(--muted); font-size: 0.78rem; text-align: center; line-height: 1.7; }
  @media (prefers-reduced-motion: reduce) {
    .product-card, .item-tile, .door { transition: none; }
    .product-card:hover, .item-tile:hover, .door:hover { transform: none; }
  }`;

const shell = (store, title, body) => {
  const s = STORES[store];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#fdfcf8"/><path fill="${s?.accent ?? "#26221c"}" d="M0 2h4v7a2 2 0 1 1-4 0zM8 2h4v7a2 2 0 1 1-4 0z"/><path fill="#ffd23f" d="M4 2h4v7a2 2 0 1 1-4 0zM12 2h4v7a2 2 0 1 1-4 0z"/></svg>`)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bevan&family=Public+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${css(s?.accent ?? "#26221c", s?.lite ?? "#eceae4")}</style>
</head>
<body>
  <div class="topbar">
    <span>Open daily 7am-9pm &middot; Family-run since 1987</span>
    <span><a href="/us"${store === "us" ? ' aria-current="true"' : ""}>US Store</a><a href="/ph"${store === "ph" ? ' aria-current="true"' : ""}>PH Store</a></span>
  </div>
  <header class="masthead">
    <div class="brand"><a href="/">Parker's Pantry</a></div>
    <div class="tagline">Neighborhood staples, priced daily.</div>${s ? `\n    <span class="storefront-label">${s.label} &middot; ${store === "us" ? "USD" : "PHP"}</span>` : ""}
  </header>${s ? `\n  <div class="awning" aria-hidden="true"></div>` : ""}
  <main>
${body}
  </main>
  <footer>Parker's Pantry is a fictional demonstration storefront for the basketwatch hackathon project. Not a real business.<br>214 Market Lane, Earth-616 &middot; Two imaginary neighborhoods, restocked daily.</footer>
</body>
</html>`;
};

const listingPage = (store) => {
  const layout = layouts[store];
  const card = layout === "b" ? cardB : cardA;
  const cards = CATALOG.map((p) => card(store, p, priceFor(store, p))).join("\n");
  const wrap = layout === "b" ? "item-list" : "product-grid";
  return shell(
    store,
    `Parker's Pantry ${STORES[store].flag} — Weekly Prices`,
    `    <h2 class="aisle-sign">This week's staples &middot; ${CATALOG.length} items</h2>\n    <div class="${wrap}">${cards}\n    </div>`,
  );
};

const productPage = (store, product) => {
  const layout = layouts[store];
  const price = priceFor(store, product);
  const body =
    layout === "b"
      ? cardB(store, product, price).replace('class="item-tile"', 'class="item-tile detail"')
      : cardA(store, product, price).replace('class="product-card"', 'class="product-card detail"');
  return shell(
    store,
    `${product.name} — Parker's Pantry ${STORES[store].flag}`,
    `    <p class="breadcrumb"><a href="/${store}">${STORES[store].label}</a> / ${product.name}</p>\n    <div class="detail-wrap">${body}\n    </div>`,
  );
};

const json = (res, status, payload) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

const html = (res, status, page) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET") {
    if (path === "/") {
      return html(
        res,
        200,
        shell(
          "root",
          "Parker's Pantry",
          `    <h2 class="aisle-sign">Pick a storefront</h2>
    <div class="doors">
      <a class="door door-us" href="/us"><span class="door-stripe" aria-hidden="true"></span><span class="door-body"><span class="door-title">US Store</span><span class="door-note">Ten weekly staples, priced in US dollars.</span></span></a>
      <a class="door door-ph" href="/ph"><span class="door-stripe" aria-hidden="true"></span><span class="door-body"><span class="door-title">PH Store</span><span class="door-note">The same ten staples, priced in Philippine pesos.</span></span></a>
    </div>`,
        ),
      );
    }
    if (path === "/healthz") return json(res, 200, { ok: true });
    if (path === "/admin/layout") return json(res, 200, { ...layouts });
    if (path === "/us" || path === "/ph") return html(res, 200, listingPage(path.slice(1)));

    const match = path.match(/^\/(us|ph)\/products\/([a-z0-9-]+)$/);
    if (match) {
      const product = CATALOG.find((p) => p.key === match[2]);
      if (!product) return json(res, 404, { error: "no such product" });
      return html(res, 200, productPage(match[1], product));
    }
  }

  if (req.method === "POST" && path === "/admin/layout") {
    if (!process.env.ADMIN_TOKEN) return json(res, 503, { error: "ADMIN_TOKEN not configured" });
    if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
      return json(res, 401, { error: "bad token" });
    }
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return json(res, 400, { error: "invalid JSON" });
    }
    const { store, layout } = parsed;
    if (!(store in layouts)) return json(res, 400, { error: 'store must be "us" or "ph"' });
    if (layout !== "a" && layout !== "b") return json(res, 400, { error: 'layout must be "a" or "b"' });
    layouts[store] = layout;
    return json(res, 200, { ...layouts });
  }

  json(res, 404, { error: "not found" });
});

const port = Number(process.env.PORT ?? 3002);
server.listen(port, () => {
  console.log(`parkers-pantry on :${port} (layouts us=${layouts.us} ph=${layouts.ph})`);
});
