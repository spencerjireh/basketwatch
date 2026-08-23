/**
 * Staple-keyword URL filtering, ported from basket.py.
 *
 * A product-page pull bills per URL visited, and a grocery sitemap runs to
 * thousands of products the index will never price. The basket only needs
 * the staples, so URLs are trimmed to slugs that name one BEFORE the page
 * ceiling spends its budget. Match rules are data (items.match jsonb),
 * never code -- this module only interprets them.
 *
 * Pure and IO-free: the caller supplies the URLs and the rules.
 */

/** The items.match jsonb shape: { must, must_by_country, exclude }. */
export type StapleMatchRule = {
  must: string[];
  mustByCountry?: Record<string, string[]>;
  exclude: string[];
};

/** Word tokens plus naive singulars, so "cubes" is caught by the term "cube". */
function tokens(text: string): Set<string> {
  const words = (text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out = new Set(words);
  for (const w of words) {
    if (w.length > 3 && w.endsWith("es")) out.add(w.slice(0, -2));
    if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
  }
  return out;
}

/** Multi-word terms match as a phrase; single words match as tokens. */
export function termHits(term: string, text: string, toks: Set<string>): boolean {
  const t = term.replaceAll("-", " ").toLowerCase().trim();
  if (t.includes(" ")) {
    const flat = (text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return ` ${flat} `.includes(` ${t} `);
  }
  return toks.has(t) || (t.endsWith("s") && toks.has(t.slice(0, -1)));
}

/** The URL's last path segment as space-delimited words, padded for phrase matching. */
export function slugWords(url: string): string {
  const seg = url.replace(/\/+$/, "").split("/").at(-1) ?? "";
  return ` ${seg
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * Keep URLs whose slug names a staple: at least one must term for the
 * country (must + must_by_country[country]) and none of that staple's
 * exclude terms. Order-preserving, so ranking done upstream survives.
 */
export function filterStapleUrls(
  urls: string[],
  rules: StapleMatchRule[],
  country: string,
): string[] {
  const compiled = rules.map((rule) => ({
    musts: [...rule.must, ...(rule.mustByCountry?.[country] ?? [])],
    excludes: rule.exclude,
  }));
  return urls.filter((url) => {
    const words = slugWords(url);
    const toks = tokens(words);
    return compiled.some(
      ({ musts, excludes }) =>
        musts.some((m) => termHits(m, words, toks)) &&
        !excludes.some((x) => termHits(x, words, toks)),
    );
  });
}
