// Throwaway: what does a given page actually look like structurally?
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const urls = process.argv.slice(2);

for (const url of urls) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } });
    const html = await res.text();
    const title = /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(html)?.[1]?.trim().replace(/\s+/g, " ") ?? "";
    const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
    const shapes = new Map();
    for (const h of hrefs) {
      const seg = h.replace(/^https?:\/\/[^/]+/, "").split("/").filter(Boolean)[0];
      if (!seg || seg.includes(".")) continue;
      shapes.set(`/${seg}/`, (shapes.get(`/${seg}/`) ?? 0) + 1);
    }
    const top = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`\n${url}`);
    console.log(`  ${res.status}  ${(html.length / 1024).toFixed(0)}kb  "${title}"`);
    console.log(`  paths: ${top.map(([p, n]) => `${p}x${n}`).join(" ")}`);
    console.log(
      `  price: jsonld=${/"@type"\s*:\s*"Product"/i.test(html)} itemprop=${/itemprop=["']price/i.test(html)} woo=${/woocommerce-Price-amount/i.test(html)} currency=${/(?:[$₱]|PHP)\s?\d{1,4}(?:[.,]\d{2})/.test(html)} cart=${/add to (?:cart|basket|bag)/i.test(html)}`,
    );
    console.log(`  spa: ${/__NEXT_DATA__|window\.__(?:INITIAL_STATE|NUXT|APOLLO|PRELOADED)/.test(html)}`);
    const sample = [...new Set(hrefs.filter((h) => /\/(product|products|p|pd|item)\//i.test(h)))].slice(0, 3);
    if (sample.length) console.log(`  product-ish: ${sample.join("\n               ")}`);
  } catch (err) {
    console.log(`\n${url}\n  FAILED ${err.cause?.code ?? err.message}`);
  }
}
