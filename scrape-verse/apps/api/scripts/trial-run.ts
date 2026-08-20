/**
 * Barebones probe of the real ingest path: Bright Data CLI -> spider-sense
 * validator -> Postgres. Not the production path (the orchestrator will call
 * the REST API and receive webhooks), but it exercises the same seam by hand
 * so the pieces can be trusted before they are wired into NestJS.
 *
 *   npm run trial -w apps/api -- <collector_id> [url] [--contract]
 *
 * First run for a scraper establishes the baseline; later runs are validated
 * against it. --contract additionally enforces the fleet output contract,
 * which only applies to scrapers that emit price records.
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { priceRecordSchema } from "@scrape-verse/shared";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../src/db/client.js";
import { baselines, runs, scrapers } from "../src/db/schema.js";
import { validateRun } from "../src/validator/checks.js";

// The one .env at the repo root; this file is a level deeper than the config.
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const exec = promisify(execFile);
const cli = (args: string[]) => exec("npx", ["brightdata", ...args], { maxBuffer: 64 * 1024 * 1024 });

/** `budget balance` ignores --json as of CLI 0.3.5, so scrape the text. */
async function balanceUsd(): Promise<string> {
  try {
    const { stdout } = await cli(["budget", "balance"]);
    return /Balance\s+(\$[0-9.]+)/.exec(stdout)?.[1] ?? "unknown";
  } catch {
    return "unavailable";
  }
}

/** Bright Data echoes the trigger payload back as `input`; it is not our data. */
const ECHOED_FIELDS = new Set(["input"]);

function nullRates(rows: Record<string, unknown>[]): Record<string, number> {
  const fields = new Set(
    rows.flatMap((row) => Object.keys(row)).filter((field) => !ECHOED_FIELDS.has(field)),
  );
  const rates: Record<string, number> = {};
  for (const field of fields) {
    const missing = rows.filter((row) => {
      const value = row[field];
      return value === null || value === undefined || value === "";
    }).length;
    rates[field] = rows.length === 0 ? 1 : missing / rows.length;
  }
  return rates;
}

async function main() {
  const [collectorId, maybeUrl] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const enforceContract = process.argv.includes("--contract");
  if (!collectorId) {
    console.error("usage: npm run trial -w apps/api -- <collector_id> [url] [--contract]");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  console.log(`budget before: ${await balanceUsd()}`);

  const args = ["scraper", "run", collectorId, ...(maybeUrl ? [maybeUrl] : []), "--sync", "--json"];
  console.log(`running: brightdata ${args.join(" ")}`);
  const { stdout } = await cli(args);
  const payload: unknown = JSON.parse(stdout);
  const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
  console.log(`rows returned: ${rows.length}`);

  const { db, sql } = createDb(databaseUrl);
  try {
    await db
      .insert(scrapers)
      .values({
        id: collectorId,
        name: collectorId,
        targetSite: maybeUrl ?? "unknown",
        outputSchema: { contract: enforceContract ? "priceRecord" : "none" },
      })
      .onConflictDoNothing();

    const [existing] = await db.select().from(baselines).where(eq(baselines.scraperId, collectorId));
    const observed = nullRates(rows);

    if (!existing) {
      await db.insert(baselines).values({
        scraperId: collectorId,
        fieldNullRates: observed,
        expectedRowCount: rows.length,
        valueRanges: {},
      });
      console.log("baseline established from this run (no validation to compare against yet)");
    }

    const baseline = {
      fieldNullRates: (existing?.fieldNullRates as Record<string, number>) ?? observed,
      expectedRowCount: existing?.expectedRowCount ?? rows.length,
      valueRanges: (existing?.valueRanges as Record<string, [number, number]>) ?? {},
    };

    const verdict = validateRun(rows, enforceContract ? priceRecordSchema : z.any(), baseline);
    const [stored] = await db
      .insert(runs)
      .values({
        scraperId: collectorId,
        trigger: "manual",
        status: verdict.status === "ok" ? "ok" : "anomalous",
        rawOutput: rows,
      })
      .returning({ id: runs.id });

    console.log(`verdict: ${verdict.status}`);
    for (const finding of verdict.findings) {
      console.log(`  [${finding.severity}] ${finding.check}: ${finding.detail}`);
    }
    console.log(`stored run ${stored?.id} with ${rows.length} rows in raw_output`);
  } finally {
    await sql.end();
  }

  console.log(`budget after: ${await balanceUsd()}`);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
