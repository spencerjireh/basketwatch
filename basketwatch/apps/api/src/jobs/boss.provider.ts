import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import PgBoss from "pg-boss";
import { type Env } from "../config/env.schema.js";
import { ALL_QUEUES, type QueueName } from "./queues.js";

/**
 * pg-boss lifecycle: a Postgres-backed queue with persistence, retries and cron
 * schedules, and no extra broker to deploy.
 *
 * Version note: pg-boss 12 is ESM-only (every 12.x release declares
 * "type": "module" and ships no require condition), and this package is
 * CommonJS. 11.x is the last CJS major and satisfies node >= 22. If 12 is ever
 * needed, moduleResolution Node16 preserves dynamic import in the emitted
 * output, so `const { default: PgBoss } = await import("pg-boss")` inside this
 * factory is the upgrade path -- it will not be silently downlevelled to a
 * require() call.
 *
 * pg-boss brings its own pg pool while the app uses postgres.js. That is
 * deliberate: sharing one pool would couple queue backpressure to query
 * latency.
 */
@Injectable()
export class BossService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BossService.name);
  private readonly boss: PgBoss;
  private started = false;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.boss = new PgBoss(config.get("DATABASE_URL", { infer: true }));
    this.boss.on("error", (err) => this.logger.error(err));
  }

  /**
   * Bootstrap rather than module init, so every module's providers exist before
   * a worker can pick up a job and call into them.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.boss.start();
    for (const queue of ALL_QUEUES) {
      await this.boss.createQueue(queue);
    }
    this.started = true;
    this.logger.log(`job queue ready: ${ALL_QUEUES.join(", ")}`);

    // No boss.schedule() yet. A cron firing into an empty handler against a
    // live database is noise; the schedule lands with the pullers module.
  }

  async onApplicationShutdown(): Promise<void> {
    this.started = false;
    await this.boss.stop({ graceful: true });
  }

  isReady(): boolean {
    return this.started;
  }

  async send(queue: QueueName, data: object, options?: PgBoss.SendOptions): Promise<string | null> {
    return this.boss.send(queue, data, options ?? {});
  }

  async work<T extends object>(
    queue: QueueName,
    handler: (jobs: PgBoss.Job<T>[]) => Promise<void>,
  ): Promise<string> {
    return this.boss.work<T>(queue, handler);
  }
}
