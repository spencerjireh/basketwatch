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

/**
 * Compose the numbered-list prompt that the experiments showed works best:
 * cheapest ($0.24 for a 4-field fix) and most precise.
 */
export function buildHealPrompt(fields: BrokenField[]): string {
  if (fields.length === 0) return "";

  const items = fields.map(
    (f, i) =>
      `(${i + 1}) ${f.name} ${f.symptom}.${f.selectorHint ? ` ${f.selectorHint}.` : ""}`,
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
