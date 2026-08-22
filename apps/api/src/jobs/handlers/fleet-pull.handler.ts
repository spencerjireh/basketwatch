import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Env } from "../../config/env.schema.js";
import { PullersService } from "../../modules/pullers/pullers.service.js";
import { BossService } from "../boss.provider.js";
import { QUEUES } from "../queues.js";

type ScrapeRunJob = { storeId: string; trigger?: "cron" | "manual" };

/** Spread the fan-out so sixteen stores are not all fetched in the same second. */
const JITTER_SECONDS = 90;

/**
 * The scheduled catalogue pull: one fleet-pull job fans out to one scrape-run
 * job per store.
 *
 * **The schedule ships disarmed.** PULL_SCHEDULE_ENABLED defaults to false, and
 * any schedule stored by an earlier deploy is removed on boot rather than left
 * to fire from history. Turning it on is a deliberate act, because the first
 * scheduled pull is the moment this project starts writing to a database that
 * holds the one thing it cannot re-collect.
 */
@Injectable()
export class FleetPullHandler implements OnApplicationBootstrap {
  private readonly logger = new Logger(FleetPullHandler.name);

  constructor(
    private readonly boss: BossService,
    private readonly pullers: PullersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work<Record<string, never>>(QUEUES.fleetPull, async () => {
      await this.fanOut();
    });

    await this.boss.work<ScrapeRunJob>(
      QUEUES.scrapeRun,
      async (jobs) => {
        for (const job of jobs) {
          // The ops API enqueues onto this same queue, so the job says which
          // it was and the run row records it honestly.
          await this.pullers.runStore(job.data.storeId, {
            dryRun: false,
            trigger: job.data.trigger ?? "cron",
          });
          // Validation is enqueued by runStore itself now -- it is part of
          // finishing a run, not something the caller has to remember.
        }
      },
      // One store at a time, and never the same store twice at once: a pull
      // that outruns the next tick must not race its own writes.
      { batchSize: 1 },
    );

    const enabled = this.config.get("PULL_SCHEDULE_ENABLED", { infer: true });
    const cron = this.config.get("PULL_SCHEDULE_CRON", { infer: true });
    if (enabled) {
      await this.boss.schedule(QUEUES.fleetPull, cron);
    } else {
      await this.boss.unschedule(QUEUES.fleetPull);
      this.logger.log(
        "catalogue pulls are disarmed (PULL_SCHEDULE_ENABLED=false); " +
          "POST /api/pullers/:storeId/run still works on demand",
      );
    }
  }

  /** One job per pullable store, each with its own jitter. */
  private async fanOut(): Promise<void> {
    const storeIds = await this.pullers.pullableStoreIds();
    this.logger.log(`fleet pull: fanning out to ${storeIds.length} stores`);

    for (const storeId of storeIds) {
      await this.boss.send(
        QUEUES.scrapeRun,
        { storeId },
        {
          startAfter: Math.floor(Math.random() * JITTER_SECONDS),
          // The store id is the singleton key, so a slow store cannot have two
          // runs in flight and double-write its own history.
          singletonKey: storeId,
          retryLimit: 2,
          retryDelay: 300,
          retryBackoff: true,
        },
      );
    }
  }
}
