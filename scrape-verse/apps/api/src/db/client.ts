import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * One connection pool per process. `max: 4` keeps the dev machine and the
 * single-container prod deploy well under Postgres defaults, since pg-boss
 * holds its own connections alongside these.
 */
export function createDb(url: string) {
  const sql = postgres(url, { max: 4 });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];
