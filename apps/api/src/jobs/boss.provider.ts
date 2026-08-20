import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
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
  /**
   * Resolved once start() and createQueue() have both finished.
   *
   * Nest runs the bootstrap hooks of providers in one module concurrently, so a
   * handler registering a worker can otherwise reach pg-boss before its queue
   * exists -- which surfaces as "cannot read properties of null" from the
   * queue cache, at boot, on one queue and not the others. Every public method
   * waits on this instead of on hook ordering.
   */
  private readonly ready: Promise<void>;
  private markReady!: () => void;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.boss = new PgBoss(config.get("DATABASE_URL", { infer: true }));
    this.boss.on("error", (err) => this.logger.error(err));
    this.ready = new Promise<void>((resolve) => {
      this.markReady = resolve;
    });
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
    this.markReady();
    this.logger.log(`job queue ready: ${ALL_QUEUES.join(", ")}`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.started = false;
    await this.boss.stop({ graceful: true });
  }

  isReady(): boolean {
    return this.started;
  }

  async send(queue: QueueName, data: object, options?: PgBoss.SendOptions): Promise<string | null> {
    await this.ready;
    return this.boss.send(queue, data, options ?? {});
  }

  async work<T extends object>(
    queue: QueueName,
    handler: (jobs: PgBoss.Job<T>[]) => Promise<void>,
    options?: PgBoss.WorkOptions,
  ): Promise<string> {
    await this.ready;
    return this.boss.work<T>(queue, options ?? {}, handler);
  }

  /**
   * Register a cron schedule, replacing any schedule already stored for the
   * queue. pg-boss keeps schedules in the database, so one left behind by an
   * earlier deploy would keep firing after the code that wanted it was gone.
   */
  async schedule(queue: QueueName, cron: string, data: object = {}): Promise<void> {
    await this.ready;
    await this.boss.schedule(queue, cron, data, { tz: "UTC" });
    this.logger.log(`scheduled ${queue} at ${cron} UTC`);
  }

  /** Remove a stored schedule, so a disarmed queue does not fire from history. */
  async unschedule(queue: QueueName): Promise<void> {
    await this.ready;
    await this.boss.unschedule(queue);
  }
}
