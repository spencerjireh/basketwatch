import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import PgBoss from "pg-boss";

/**
 * pg-boss job layer: Postgres-backed queue with persistence, retries, and
 * cron schedules — no extra broker. Queues:
 *  - fleet-scrape: scheduled 2x daily, one job per scraper (fan-out TODO)
 *  - heal: enqueued by the validator when an incident opens
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBoss | null = null;

  async onModuleInit() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.logger.warn("DATABASE_URL not set — job queue disabled (dev mode)");
      return;
    }
    this.boss = new PgBoss(url);
    this.boss.on("error", (err) => this.logger.error(err));
    await this.boss.start();

    await this.boss.createQueue("fleet-scrape");
    await this.boss.createQueue("heal");

    // 06:00 and 18:00 UTC; jitter per scraper happens inside the handler.
    await this.boss.schedule("fleet-scrape", "0 6,18 * * *");

    await this.boss.work("fleet-scrape", async () => {
      this.logger.log("fleet-scrape tick — TODO: trigger Studio runs per scraper");
    });
    await this.boss.work("heal", async ([job]) => {
      this.logger.log(`heal job ${job?.id} — TODO: run heal orchestrator`);
    });

    this.logger.log("pg-boss started; fleet-scrape scheduled 2x daily");
  }

  async enqueueHeal(incidentId: string) {
    if (!this.boss) return null;
    return this.boss.send("heal", { incidentId }, { retryLimit: 2, retryBackoff: true });
  }

  async onModuleDestroy() {
    await this.boss?.stop({ close: true });
  }
}
