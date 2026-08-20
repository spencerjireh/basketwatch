import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// One .env for the whole repo, at the repo ROOT - three levels up from here,
// beside the compose files. `../../.env` pointed at scrape-verse/, which does
// not exist, so every drizzle-kit command silently ran with no DATABASE_URL.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
