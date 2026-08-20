// Throwaway: show the product anchors a page actually exposes.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const url = process.argv[2];
const res = await fetch(url, { headers: { "user-agent": UA } });
const html = await res.text();
console.log(`${res.status} ${(html.length / 1024).toFixed(0)}kb ${res.url}`);

const found = [];
for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'\s#]+)["'][^>]*>/gi)) {
  if (!/\/products\/|\/p\//i.test(m[1]) || m[1].includes("{{")) continue;
  const start = m.index + m[0].length;
  const context = html.slice(start, start + 800).split(/<\/a>/i)[0];
  const inner = context.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const label = /(?:alt|title|aria-label)=["']([^"']{2,140})["']/i.exec(m[0] + context)?.[1] ?? "";
  found.push({ href: m[1], text: [inner, label].filter(Boolean).join(" | ").slice(0, 90) });
}
console.log(`product anchors: ${found.length}`);
for (const f of found.slice(0, 12)) console.log(`  ${f.href}\n      text: ${f.text || "(empty)"}`);
