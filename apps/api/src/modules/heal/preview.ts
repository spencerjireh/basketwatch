import { coercePrice, keyFromUrl } from "../pullers/adapters/studio.adapter.js";

/**
 * Bright Data's heal preview_result is raw Studio output: prices as page text
 * ("PHP 389.50", {value: 6.99}), url under several aliases, sometimes a
 * wrapper row nesting the products. The judge needs the same four fields the
 * validator's parse predicate checks, so this mirrors the adapter's toRows
 * just far enough to produce them.
 *
 * A row without a resolvable url or price is dropped rather than repaired:
 * for a heal preview that absence IS the signal -- a proposal whose sample
 * rows mostly vanish here has not fixed the selectors, and the shrunken (or
 * empty) sample is what validateSample then judges.
 */
export function normalizePreviewRows(previewResult: unknown[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const item of flatten(previewResult)) {
    const url = firstString(
      item.url,
      item.page_url,
      item.product_url,
      item.product_page_url,
      item.input_url,
      (item.input as Record<string, unknown> | undefined)?.url,
    );
    const price = coercePrice(item.price);
    if (!url || price === null) continue;

    rows.push({
      product_key: keyFromUrl(url),
      name: firstString(item.name, item.title, item.product_name) ?? "",
      price,
      url,
    });
  }

  return rows;
}

function flatten(raw: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const nested = row.products ?? row.items ?? row.results;
    if (Array.isArray(nested) && nested.length > 0) {
      for (const child of nested) {
        if (child && typeof child === "object" && !Array.isArray(child)) {
          out.push(child as Record<string, unknown>);
        }
      }
    } else {
      out.push(row);
    }
  }
  return out;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}
