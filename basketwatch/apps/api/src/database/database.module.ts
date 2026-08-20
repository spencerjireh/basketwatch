import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type Env } from "../config/env.schema.js";
import { DRIZZLE, PG_SQL } from "./database.tokens.js";
import * as schema from "./schema.js";

export type Sql = ReturnType<typeof postgres>;
export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Provides the Drizzle instance and the raw postgres.js handle.
 *
 * The raw handle exists for the readiness probe and for the occasional query
 * that reads better as SQL. Everything else goes through Drizzle, and only from
 * a *.repository.ts file -- the lint rule in @basketwatch/eslint-config/nest
 * enforces that boundary so queries cannot drift into controllers.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_SQL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Sql => {
        const url = config.get("DATABASE_URL", { infer: true });
        // One pool per process. max: 4 keeps a dev laptop and the
        // single-container prod deploy well inside max_connections=100, because
        // pg-boss holds its own connections alongside these and the team opens
        // psql sessions against the same database.
        return postgres(url, { max: 4, onnotice: () => {} });
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_SQL, ConfigService],
      useFactory: (sql: Sql, config: ConfigService<Env, true>): Db =>
        drizzle(sql, {
          schema,
          logger: config.get("NODE_ENV", { infer: true }) === "development",
        }),
    },
  ],
  exports: [DRIZZLE, PG_SQL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_SQL) private readonly sql: Sql) {}

  /** Requires app.enableShutdownHooks() in main.ts. */
  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
