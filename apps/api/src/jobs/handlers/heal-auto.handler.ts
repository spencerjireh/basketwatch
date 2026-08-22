import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { HealOrchestrator } from "../../modules/heal/heal.orchestrator.js";
import { BossService } from "../boss.provider.js";
import { QUEUES } from "../queues.js";

type HealJob = { scraperId: string; storeId: string; incidentId: string };

/**
 * Consumes heal jobs enqueued by the validator when a run is diagnosed as
 * broken. Proposes a heal to Bright Data but does NOT auto-approve -- the
 * dashboard shows the diff for human review.
 */
@Injectable()
export class HealAutoHandler implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealAutoHandler.name);

  constructor(
    private readonly boss: BossService,
    private readonly orchestrator: HealOrchestrator,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work<HealJob>(
      QUEUES.heal,
      async (jobs) => {
        for (const job of jobs) {
          const { scraperId, storeId } = job.data;
          try {
            const result = await this.orchestrator.trigger(scraperId, {});
            this.logger.log(
              `${storeId}: auto-heal triggered for ${scraperId} -- ` +
                `status=${result.status}, prompt="${result.prompt?.slice(0, 60)}..."`,
            );
          } catch (err) {
            this.logger.error(
              `${storeId}: auto-heal failed for ${scraperId} -- ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
      { batchSize: 1 },
    );
  }
}
