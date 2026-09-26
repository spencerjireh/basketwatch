import path from "node:path";
import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
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
        // One pool per process. max: 4 keeps the API well inside
        // max_connections=100 alongside the collector's pool and pg-boss.
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
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(PG_SQL) private readonly sql: Sql,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Apply pending migrations before anything else starts.
   *
   * A deploy pulls main and runs compose -- there is no step in between where
   * a human runs drizzle-kit. onModuleInit runs ahead of every
   * onApplicationBootstrap hook, so the controllers only ever see a migrated
   * schema.
   *
   * Migrations run on their own short-lived connection as the owner role
   * (MIGRATION_DATABASE_URL). The pool this module serves requests from is a
   * read-only role in production, which can neither migrate nor write --
   * every write belongs to the private collector.
   *
   * Idempotent: drizzle keeps its own journal and skips what has already run.
   */
  async onModuleInit(): Promise<void> {
    // dist/database/ at runtime, src/database/ in dev: the same two levels up
    // from either, which is what keeps this one path.
    const migrationsFolder = path.join(__dirname, "..", "..", "drizzle");
    const url =
      this.config.get("MIGRATION_DATABASE_URL", { infer: true }) ||
      this.config.getOrThrow<string>("DATABASE_URL");
    const owner = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(owner), { migrationsFolder });
    } finally {
      await owner.end({ timeout: 5 });
    }
    this.logger.log("database schema up to date");
  }

  /** Requires app.enableShutdownHooks() in main.ts. */
  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
