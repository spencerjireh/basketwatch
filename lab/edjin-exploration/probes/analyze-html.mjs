// Throwaway: same signal read as vet-tier1, but over saved Unlocker output.
import { readFile } from "node:fs/promises";

const CURRENCY = /(?:[$₱]|PHP|USD)\s?\d{1,4}(?:[.,]\d{2})/;
const PRODUCT_PATH = /\/(?:product|products|p|pd|pr|prod|item|items|dp|buy)\/[^/?#]{2,}/i;

for (const path of process.argv.slice(2)) {
  const html = await readFile(path, "utf8");
  const title = /<title[^>]*>([\s\S]{0,160}?)<\/title>/i.exec(html)?.[1]?.trim().replace(/\s+/g, " ") ?? "";
  const hrefs = [...html.matchAll(/href=["']([^"'\s#]+)["']/gi)].map((m) => m[1]);
  const products = [...new Set(hrefs.filter((h) => PRODUCT_PATH.test(h) && !h.includes("{{")))];
  const prices = [...html.matchAll(/(?:[$₱]|PHP)\s?\d{1,4}(?:[.,]\d{2})/g)].map((m) => m[0]);
  console.log(`\n${path}  ${(html.length / 1024).toFixed(0)}kb`);
  console.log(`  title: "${title}"`);
  console.log(
    `  jsonld=${/"@type"\s*:\s*"Product"/i.test(html)} itemprop=${/itemprop=["']price/i.test(html)} currency=${CURRENCY.test(html)} cart=${/add to (?:cart|basket|bag)/i.test(html)}`,
  );
  console.log(`  product links: ${products.length}, price strings: ${prices.length}`);
  if (prices.length) console.log(`  sample prices: ${[...new Set(prices)].slice(0, 6).join(" ")}`);
  for (const p of products.slice(0, 4)) console.log(`    ${p}`);
  const challenge = /just a moment|captcha|access denied|unusual traffic|verify you are human/i.exec(html);
  if (challenge) console.log(`  CHALLENGE TEXT: ${challenge[0]}`);
}
