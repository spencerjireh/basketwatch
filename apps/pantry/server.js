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

const STORES = {
  us: { label: "US Store", accent: "#1d4ed8", flag: "US" },
  ph: { label: "PH Store", accent: "#b91c1c", flag: "PH" },
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

const css = (accent) => `
  :root { --accent: ${accent}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; background: #faf7f2; color: #292524; }
  header { background: var(--accent); color: #fff; padding: 1.5rem 2rem; }
  header .brand { font-size: 1.6rem; font-weight: bold; letter-spacing: 0.02em; }
  header .tagline { font-size: 0.9rem; opacity: 0.85; margin-top: 0.25rem; }
  nav { padding: 0.6rem 2rem; background: #fff; border-bottom: 1px solid #e7e5e4; font-size: 0.9rem; }
  nav a { color: var(--accent); text-decoration: none; margin-right: 1.25rem; }
  main { max-width: 960px; margin: 0 auto; padding: 2rem; }
  h2 { font-size: 1.2rem; margin-bottom: 1.25rem; color: #44403c; }
  .product-grid, .item-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
  .product-card, .item-tile { display: block; background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 1rem; text-decoration: none; color: inherit; }
  .product-card:hover, .item-tile:hover { border-color: var(--accent); }
  .product-name, .item-title { font-size: 0.95rem; margin-bottom: 0.5rem; font-weight: normal; }
  .price { color: var(--accent); font-size: 1.15rem; font-weight: bold; display: block; }
  .item-cost { color: var(--accent); font-weight: bold; }
  .cost-whole { font-size: 1.15rem; }
  .cost-cents { font-size: 0.8rem; vertical-align: super; }
  .size, .item-pack { color: #78716c; font-size: 0.8rem; display: inline-block; margin-top: 0.3rem; }
  .stock, .availability { float: right; margin-top: 0.3rem; font-size: 0.75rem; color: #15803d; }
  .detail { background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 2rem; max-width: 480px; }
  .detail .price, .detail .item-cost { font-size: 1.6rem; margin: 0.75rem 0; }
  footer { max-width: 960px; margin: 0 auto; padding: 1rem 2rem 2rem; color: #a8a29e; font-size: 0.78rem; }`;

const shell = (store, title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css(STORES[store]?.accent ?? "#57534e")}</style>
</head>
<body>
  <header>
    <div class="brand">Parker's Pantry${store in STORES ? ` — ${STORES[store].label}` : ""}</div>
    <div class="tagline">Neighborhood staples, priced daily.</div>
  </header>
  <nav><a href="/us">US Store</a><a href="/ph">PH Store</a></nav>
  <main>
${body}
  </main>
  <footer>Parker's Pantry is a fictional demonstration storefront for the basketwatch hackathon project. Not a real business.</footer>
</body>
</html>`;

const listingPage = (store) => {
  const layout = layouts[store];
  const card = layout === "b" ? cardB : cardA;
  const cards = CATALOG.map((p) => card(store, p, priceFor(store, p))).join("\n");
  const wrap = layout === "b" ? "item-list" : "product-grid";
  return shell(
    store,
    `Parker's Pantry ${STORES[store].flag} — Weekly Prices`,
    `    <h2>This week's staples (${CATALOG.length} items)</h2>\n    <div class="${wrap}">${cards}\n    </div>`,
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
    `    <h2>${product.name}</h2>\n    <div class="detail-wrap">${body}\n    </div>\n    <p style="margin-top:1rem"><a href="/${store}" style="color:var(--accent)">← Back to all staples</a></p>`,
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
          `    <h2>Pick a storefront</h2>\n    <p style="line-height:2"><a href="/us" style="color:#1d4ed8">Parker's Pantry — US Store (USD)</a><br><a href="/ph" style="color:#b91c1c">Parker's Pantry — PH Store (PHP)</a></p>`,
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
