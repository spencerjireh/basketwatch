import { type RunStatus } from "@basketwatch/contract";

/**
 * The runs.status column holds an older vocabulary across live rows:
 * ok | anomalous | error. The contract uses ok | suspect | broken, which is
 * what the validator and the scraper state machine speak.
 *
 * Every read translates here and nowhere else. Forgetting this shows up as a
 * fleet board full of blank statuses, which is a bad thing to discover during a
 * demo, so it is one function with one test rather than an inline ternary.
 *
 * Migration 0001 normalises the stored rows, after which fromDb can go.
 */
export function runStatusFromDb(value: string | null): RunStatus | null {
  switch (value) {
    case null:
      return null;
    case "ok":
      return "ok";
    case "anomalous":
    case "suspect":
      return "suspect";
    case "error":
    case "broken":
      return "broken";
    default:
      return null;
  }
}

/** Writes use the contract vocabulary directly; 0001 makes this the only one. */
export function runStatusToDb(value: RunStatus): string {
  return value;
}
