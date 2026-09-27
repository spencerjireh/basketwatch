import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// One .env for the whole repo, at the repo ROOT, beside the compose files.
// Resolved from cwd rather than import.meta.url: drizzle-kit bundles this file
// with esbuild and this package is CommonJS, so import.meta is not available.
// drizzle-kit runs with cwd = apps/api, so two levels up lands at the root.
config({ path: "../../.env" });

const url = process.env.DATABASE_URL ?? "";

/**
 * Refuse to touch a non-local database unless it is asked for explicitly.
 *
 * The repo-root .env now points at the local database, so the common mistake
 * this was written for is gone. The guard stays anyway: production holds 28k
 * observations and is the demo, and one `set -a; . ./.env.prod` in the wrong
 * shell is all it would take. dotenv does not override an already-set variable,
 * so the safe path -- passing DATABASE_URL inline -- still works.
 *
 * To run against the deployed database on purpose:
 *   ALLOW_REMOTE_DB=1 pnpm db:check
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

if (url && process.env.ALLOW_REMOTE_DB !== "1") {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  if (host && !LOCAL_HOSTS.has(host)) {
    throw new Error(
      [
        `drizzle-kit is pointed at a remote database (${host}), and that is refused by default.`,
        "",
        "The repo-root .env points at the deployed Postgres. If you meant local dev:",
        "  DATABASE_URL=postgres://basketwatch:basketwatch@localhost:5432/basketwatch pnpm db:migrate",
        "",
        "If you really mean the deployed database, say so:",
        "  ALLOW_REMOTE_DB=1 pnpm db:check",
      ].join("\n"),
    );
  }
}

export default defineConfig({
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  // Prompt before anything destructive.
  strict: true,
});
