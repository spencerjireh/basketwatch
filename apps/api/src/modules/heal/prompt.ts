import { type CheckResult } from "@basketwatch/contract";

/**
 * A field the heal prompt will mention. Kept separate from CheckResult so the
 * prompt generator stays pure and testable without a validator dependency.
 */
export interface BrokenField {
  name: string;
  symptom: string;
  selectorHint?: string;
}

const PROMPT_CHAR_LIMIT = 1000;

const EXPECTED_FIELDS = ["name", "price", "url", "currency", "in_stock", "category", "size"];

/**
 * Compose the numbered-list prompt that the experiments showed works best:
 * cheapest ($0.24 for a 4-field fix) and most precise.
 */
export function buildHealPrompt(fields: BrokenField[]): string {
  if (fields.length === 0) return "";

  const items = fields.map(
    (f, i) => `(${i + 1}) ${f.name} ${f.symptom}.${f.selectorHint ? ` ${f.selectorHint}.` : ""}`,
  );
  const prompt = `Fix these issues:\n\n${items.join("\n")}`;

  if (prompt.length > PROMPT_CHAR_LIMIT) {
    return prompt.slice(0, PROMPT_CHAR_LIMIT - 3) + "...";
  }
  return prompt;
}

/**
 * Turn validator CheckResult findings into actionable BrokenField entries
 * the prompt generator can consume.
 *
 * Only `nulls` and `drift` findings carry a field name in their detail string.
 * `schema` and `rowcount` are too generic to produce targeted heal prompts, so
 * they are folded into a single catch-all entry.
 */
export function findingsToFields(findings: CheckResult[]): BrokenField[] {
  const fields: BrokenField[] = [];
  let hasGenericIssue = false;

  for (const f of findings) {
    if (f.check === "nulls") {
      const match = f.detail.match(/^(\S+):\s*null-rate\s+(\d+)%/);
      if (match?.[1] && match[2]) {
        fields.push({
          name: match[1],
          symptom: `returns null (${match[2]}% null-rate)`,
        });
        continue;
      }
    }

    if (f.check === "drift") {
      const match = f.detail.match(/^(\S+):\s*(\d+)%\s*of values outside/);
      if (match?.[1] && match[2]) {
        fields.push({
          name: match[1],
          symptom: `values appear incorrect (${match[2]}% outside expected range)`,
        });
        continue;
      }
    }

    if (f.check === "rowcount") {
      const match = f.detail.match(/got (\d+), expected ~(\d+)/);
      if (match) {
        fields.push({
          name: "data collection",
          symptom: `returns ${match[1]} rows, expected ~${match[2]}`,
        });
        continue;
      }
    }

    hasGenericIssue = true;
  }

  if (hasGenericIssue && fields.length === 0) {
    fields.push({
      name: "scraper output",
      symptom: "fails validation checks -- inspect and fix extraction logic",
    });
  }

  return fields;
}

/**
 * Inspect the raw Studio output to produce specific, actionable findings.
 *
 * This is where the diagnostic intelligence lives: rather than generic
 * "null rate 95%" messages, this function tells Studio exactly what it
 * returned versus what we expected.
 */
export function diagnoseRawOutput(raw: unknown[]): BrokenField[] {
  if (raw.length === 0) {
    return [
      {
        name: "data collection",
        symptom: "returns no data at all",
        selectorHint:
          "Check that the CSS selectors match the current page structure and that the scraper navigates correctly",
      },
    ];
  }

  const fields: BrokenField[] = [];
  const actualFields = collectFieldNames(raw);

  if (actualFields.size === 0) {
    return [
      {
        name: "scraper output",
        symptom: "returned rows are not objects with named fields",
        selectorHint: "The scraper should return objects with fields like name, price, url",
      },
    ];
  }

  for (const expected of EXPECTED_FIELDS) {
    if (actualFields.has(expected)) continue;

    const alias = findAlias(expected, actualFields);
    if (alias) {
      fields.push({
        name: expected,
        symptom: `is missing; the scraper returns '${alias}' instead`,
        selectorHint: `Rename '${alias}' to '${expected}'`,
      });
    } else if (expected === "price" || expected === "name" || expected === "url") {
      fields.push({
        name: expected,
        symptom: "is missing from the output entirely",
        selectorHint: `Add a '${expected}' field to the extraction logic`,
      });
    }
  }

  const typeIssues = checkFieldTypes(raw);
  for (const issue of typeIssues) {
    if (!fields.some((f) => f.name === issue.name)) {
      fields.push(issue);
    }
  }

  return fields;
}

function collectFieldNames(raw: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const item of raw.slice(0, 10)) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item as Record<string, unknown>)) {
        names.add(key);
      }
    }
  }
  return names;
}

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["title", "product_name", "product_title", "item_name"],
  price: ["cost", "amount", "product_price", "sale_price", "regular_price"],
  url: ["link", "href", "product_url", "page_url", "product_page_url"],
  currency: ["currency_code", "currency_symbol"],
  in_stock: ["availability", "stock", "is_available", "stock_status"],
  category: ["type", "product_type", "department"],
  size: ["weight", "size_or_weight", "volume", "quantity", "unit"],
};

function findAlias(expected: string, actual: Set<string>): string | null {
  const aliases = FIELD_ALIASES[expected];
  if (!aliases) return null;
  for (const alias of aliases) {
    if (actual.has(alias)) return alias;
  }
  return null;
}

/**
 * Check whether core fields have the right type in the raw output.
 * A string price like "PHP 389.50" should ideally be a number.
 */
function checkFieldTypes(raw: unknown[]): BrokenField[] {
  const issues: BrokenField[] = [];
  const sample = raw.slice(0, 5) as Record<string, unknown>[];

  const stringPrices = sample.filter((r) => typeof r.price === "string").length;
  if (stringPrices > 0 && stringPrices >= sample.length * 0.5) {
    const example = String(sample.find((r) => typeof r.price === "string")?.price ?? "");
    issues.push({
      name: "price",
      symptom: `is a string ("${example.slice(0, 30)}") instead of a number`,
      selectorHint: "Extract the numeric value only, without currency symbols or text",
    });
  }

  const nullPrices = sample.filter((r) => r.price === null || r.price === undefined).length;
  if (nullPrices > 0 && nullPrices >= sample.length * 0.5) {
    issues.push({
      name: "price",
      symptom: `is null in ${nullPrices}/${sample.length} sampled rows`,
      selectorHint: "The price selector does not match the current page layout",
    });
  }

  const nullNames = sample.filter((r) => r.name === null || r.name === undefined).length;
  if (nullNames > 0 && nullNames >= sample.length * 0.5) {
    issues.push({
      name: "name",
      symptom: `is null in ${nullNames}/${sample.length} sampled rows`,
      selectorHint: "The product name selector does not match the current page layout",
    });
  }

  return issues;
}
