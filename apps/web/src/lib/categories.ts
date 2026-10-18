/**
 * The store categories from the collector's registry. A filter on these is a
 * filter on stores, not products: a supermarket's soap is under grocery.
 */
export const CATEGORIES = [
  ["grocery", "Grocery"],
  ["pharmacy", "Pharmacy"],
  ["electronics", "Electronics"],
  ["appliances", "Appliances"],
  ["home", "Home"],
  ["hardware", "Hardware"],
  ["department", "Department"],
  ["fashion", "Fashion"],
  ["sports", "Sports"],
  ["books", "Books"],
  ["baby-toys", "Baby & toys"],
  ["pets", "Pets"],
] as const;

export type CategoryKey = (typeof CATEGORIES)[number][0];

export function categoryLabel(key: string | null): string | null {
  return CATEGORIES.find(([k]) => k === key)?.[1] ?? null;
}
