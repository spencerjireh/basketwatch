#!/usr/bin/env node
/**
 * Ingest a downloaded Studio dataset into the local database, the way a
 * completed pipeline pull would have -- for runs the CLI abandoned but
 * Bright Data finished anyway (the Aug 23 zombie salvage).
 *
 * Usage: node lab/scripts/ingest-dataset.mjs --store ph-shopsuki --file sukli.json
 *
 * Mirrors the pipeline: flatten nested products[], coerce prices, key by URL
 * slug, then BRIDGE slugs to the store's existing product keys via
 * products.url -- the HTTP-era catalogue used Shopify numeric ids, and the
 * basket pins point at those, so a slug-keyed observation would never
 * reprice the basket. Change-only history: only new/moved prices insert.
 * The products upsert deliberately does NOT touch size columns -- the
 * HTTP-era sizes are richer than anything in these datasets.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(path.join(repo, "apps", "api", "package.json"));
const postgres = require_("postgres");

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean),
);
const storeId = args.store;
const file = args.file;
const force = "force" in args || process.argv.includes("--force");
if (!storeId || !file) {
  console.error("usage: ingest-dataset.mjs --store <storeId> --file <dataset.json> [--force]");
  process.exit(2);
}

const DB_URL = process.env.DATABASE_URL ?? "postgres://basketwatch:basketwatch@localhost:5432/basketwatch";
const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });

const RE_PRICE = /[-+]?\d[\d,\s]*(?:\.\d+)?/;
function coercePrice(value) {
  if (typeof value === "number") return value > 0 ? value : null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return coercePrice(value.value ?? value.amount ?? value.price);
  }
  if (typeof value !== "string") return null;
  const m = RE_PRICE.exec(value);
  if (!m) return null;
  const p = Number.parseFloat(m[0].replace(/[,\s]/g, ""));
  return Number.isFinite(p) && p > 0 ? p : null;
}
function keyFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/\/$/, "").split("/").at(-1) || url;
  } catch {
    return url;
  }
}
function slugOf(url) {
  return url ? keyFromUrl(url) : null;
}
const firstString = (...vals) => vals.find((v) => typeof v === "string" && v.length > 0) ?? null;

async function main() {
  const [store] = await sql`select store_id, country, currency from stores where store_id = ${storeId}`;
  if (!store) throw new Error(`unknown store ${storeId}`);

  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`dataset is not an array (status page?): ${JSON.stringify(raw).slice(0, 120)}`);

  // Flatten: listing records wrap products in products[]/items[]/results[].
  const flat = [];
  for (const item of raw) {
    const nested = item?.products ?? item?.items ?? item?.results;
    if (Array.isArray(nested) && nested.length > 0) {
      for (const child of nested) if (child && typeof child === "object") flat.push(child);
    } else if (item && typeof item === "object") {
      flat.push(item);
    }
  }

  // The slug -> existing-key bridge, from the store's own catalogue.
  const existing = await sql`select product_key, url from products where store_id = ${storeId}`;
  const bridge = new Map();
  for (const row of existing) {
    const slug = slugOf(row.url);
    if (slug && !bridge.has(slug)) bridge.set(slug, row.product_key);
  }

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const seen = new Set();
  const rows = [];
  for (const item of flat) {
    const url = firstString(item.url, item.page_url, item.product_url, item.product_page_url, item.input_url, item?.input?.url);
    const price = coercePrice(item.price);
    if (!url || price === null) continue;
    const name = (firstString(item.name, item.title, item.product_name) ?? "").trim().slice(0, 200);
    if (!name) continue;
    const slug = keyFromUrl(url);
    const productKey = bridge.get(slug) ?? slug;
    if (seen.has(productKey)) continue;
    seen.add(productKey);
    rows.push({
      productKey,
      name,
      price,
      currency: firstString(item.currency) || store.currency,
      url,
      inStock: item.in_stock !== false,
      category: firstString(item.category),
    });
  }
  if (rows.length === 0) throw new Error("no usable rows in dataset");

  const prev = new Map(
    (await sql`select product_key, price::text as price from latest_price where store_id = ${storeId}`).map((r) => [
      r.product_key,
      Number.parseFloat(r.price),
    ]),
  );
  const changes = [];
  for (const row of rows) {
    const before = prev.get(row.productKey);
    if (before === undefined) {
      changes.push({ ...row, change: "new", previousPrice: null, delta: null });
    } else if (Math.abs(before - row.price) > 1e-9) {
      changes.push({ ...row, change: "price", previousPrice: before, delta: Math.round((row.price - before) * 1e4) / 1e4 });
    }
  }
  const bridged = rows.filter((r) => !String(r.productKey).includes("-")).length;
  const established = prev.size > 0;
  const massChange = established && rows.length > 100 && changes.length / rows.length > 0.9;
  console.log(
    `${storeId}: ${flat.length} raw -> ${rows.length} priced rows (${bridged} on existing keys), ` +
      `${changes.length} changes (${changes.filter((c) => c.change === "price").length} price moves)`,
  );
  if (massChange && !force) {
    console.error("ABORT: >90% change rate on an established store -- key-scheme drift? Re-run with --force to override.");
    process.exit(3);
  }

  const runId = await sql.begin(async (tx) => {
    const [run] = await tx`
      insert into runs (store_id, at, method, transport, source, trigger, status,
                        rows, unit_priced, pages, ceiling_reached, changes, coverage, raw_output)
      values (${storeId}, now(), 'sitemap', 'studio', 'studio', 'manual', 'ok',
              ${rows.length}, 0, ${raw.length}, false, ${changes.length}, null, null)
      returning id`;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      await tx`
        insert into products (store_id, product_key, name, url, category, first_seen, last_seen)
        values ${tx(batch.map((p) => [storeId, p.productKey, p.name, p.url, p.category, nowIso, nowIso]))}
        on conflict (store_id, product_key) do update set
          name = excluded.name,
          url = excluded.url,
          last_seen = excluded.last_seen`;
    }
    for (let i = 0; i < changes.length; i += 500) {
      const batch = changes.slice(i, i + 500);
      await tx`
        insert into price_observations (run_id, store_id, product_key, observed_at, price,
                                        currency, unit_price, unit_price_basis, in_stock,
                                        source, change, previous_price, delta)
        values ${tx(
          batch.map((c) => [
            run.id, storeId, c.productKey, nowIso, c.price, c.currency, null, null,
            c.inStock, "studio", c.change, c.previousPrice, c.delta,
          ]),
        )}`;
    }
    return run.id;
  });
  console.log(`run ${runId} recorded: ${rows.length} rows, ${changes.length} observations`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err.message ?? err);
    await sql.end();
    process.exit(1);
  });
