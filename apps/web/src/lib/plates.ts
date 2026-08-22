/**
 * The staple plates: ten pieces of art under `public/plates/`, traced from
 * public-domain source imagery by `lab/plates/trace.py` and keyed by the same
 * itemKeys the basket uses.
 *
 * Each file carries three nested ink bands and its own edge fade, and no
 * opacity of its own -- the caller sets that, and the three bands lift in
 * proportion. See the pipeline's README for the contract.
 */

/**
 * Reading order for the places that show all ten at once. The basket's own
 * order comes from the API; this is only for surfaces that have no rails in
 * hand, which today means /prices.
 */
export const PLATE_KEYS = [
  "rice",
  "bread",
  "pasta",
  "milk",
  "eggs",
  "chicken",
  "cooking_oil",
  "sugar",
  "coffee",
  "bananas",
] as const;

export type PlateKey = (typeof PLATE_KEYS)[number];

const KEYS = new Set<string>(PLATE_KEYS);

/** The plate for a staple, or null where there is no art for that key. */
export function plateSrc(itemKey: string): string | null {
  return KEYS.has(itemKey) ? `/plates/${itemKey}.svg` : null;
}

/**
 * Names and searches for the staple shortcuts on /prices. A rail carries its
 * own label, so this is deliberately not used anywhere a rail is available --
 * two sources for one name is how they drift apart.
 *
 * The query is what the shortcut types into the search, not the staple key:
 * the catalogue is 28,000 free-text product names, and "cooking_oil" matches
 * none of them.
 */
export const PLATE_SEARCH: Record<PlateKey, { label: string; query: string }> = {
  rice: { label: "Rice", query: "rice" },
  bread: { label: "Bread", query: "bread" },
  pasta: { label: "Pasta", query: "spaghetti" },
  milk: { label: "Milk", query: "milk" },
  eggs: { label: "Eggs", query: "eggs" },
  chicken: { label: "Chicken", query: "chicken" },
  cooking_oil: { label: "Cooking oil", query: "cooking oil" },
  sugar: { label: "Sugar", query: "sugar" },
  coffee: { label: "Coffee", query: "coffee" },
  bananas: { label: "Bananas", query: "banana" },
};
