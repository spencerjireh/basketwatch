import { createServer } from "node:http";

/**
 * The chaos target: a fake grocery store whose markup can be mutated on
 * demand to break scrapers in a controlled, reproducible way.
 *
 * Layout A: prices in .price spans with data-sku attributes.
 * Layout B: renamed classes, price split into whole/cents nested spans,
 *           product key moved into a data-testid attribute.
 *
 * Toggle: POST /admin/layout {"layout":"a"|"b"} with X-Admin-Token header,
 * or set LAYOUT env var at boot. GET / serves the store page.
 * Disclosed as a test target in the hackathon submission.
 */

const PRODUCTS = [
  { key: "eggs-12", name: "Eggs (dozen)", price: 4.49, unit: "dozen" },
  { key: "milk-1g", name: "Whole Milk (1 gal)", price: 3.89, unit: "gallon" },
  { key: "bread-loaf", name: "White Bread", price: 2.79, unit: "loaf" },
  { key: "rice-5lb", name: "Long Grain Rice (5 lb)", price: 6.99, unit: "bag" },
  { key: "coffee-12oz", name: "Ground Coffee (12 oz)", price: 9.49, unit: "bag" },
  { key: "sugar-4lb", name: "Granulated Sugar (4 lb)", price: 3.59, unit: "bag" },
  { key: "chicken-lb", name: "Chicken Breast (per lb)", price: 4.29, unit: "lb" },
  { key: "oil-48oz", name: "Vegetable Oil (48 oz)", price: 5.19, unit: "bottle" },
  { key: "pasta-1lb", name: "Spaghetti (1 lb)", price: 1.89, unit: "box" },
  { key: "bananas-lb", name: "Bananas (per lb)", price: 0.69, unit: "lb" },
];

let layout = (process.env.LAYOUT ?? "a").toLowerCase();

const productHtmlA = (p) => `
  <div class="product" data-sku="${p.key}">
    <h3 class="product-name">${p.name}</h3>
    <span class="price">$${p.price.toFixed(2)}</span>
    <span class="unit">per ${p.unit}</span>
    <span class="stock in-stock">In stock</span>
  </div>`;

const productHtmlB = (p) => {
  const [whole, cents] = p.price.toFixed(2).split(".");
  return `
  <article class="item-card" data-testid="sku-${p.key}">
    <h3 class="item-title">${p.name}</h3>
    <div class="cost"><span class="cost-currency">$</span><span class="cost-whole">${whole}</span><span class="cost-cents">${cents}</span></div>
    <div class="item-meta"><span>per ${p.unit}</span><span class="availability" data-state="available">Available</span></div>
  </article>`;
};

const page = () => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Parker's Pantry — Weekly Prices</title></head>
<body>
  <h1>Parker's Pantry</h1>
  <p>Neighborhood staples, updated daily. (Test target for the Scrape-Verse hackathon.)</p>
  <main id="catalog">
    ${PRODUCTS.map(layout === "b" ? productHtmlB : productHtmlA).join("\n")}
  </main>
</body>
</html>`;

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page());
  }
  if (req.method === "GET" && req.url === "/admin/layout") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ layout }));
  }
  if (req.method === "POST" && req.url === "/admin/layout") {
    if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
      res.writeHead(401);
      return res.end();
    }
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });
    const requested = JSON.parse(body || "{}").layout;
    if (requested !== "a" && requested !== "b") {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: 'layout must be "a" or "b"' }));
    }
    layout = requested;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ layout }));
  }
  res.writeHead(404);
  res.end();
});

const port = Number(process.env.PORT ?? 3002);
server.listen(port, () => console.log(`clone-store (layout ${layout}) on :${port}`));
