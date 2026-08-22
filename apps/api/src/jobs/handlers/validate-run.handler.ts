import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ValidatorService } from "../../modules/validator/validator.service.js";
import { BossService } from "../boss.provider.js";
import { QUEUES } from "../queues.js";

type ValidateRunJob = { runId: number; storeId: string };

/**
 * Consumes validate-run jobs enqueued after each puller run completes.
 *
 * One at a time, same-store deduplication: a second pull for the same store
 * that arrives while the first is still being validated is collapsed rather
 * than raced against it.
 */
@Injectable()
export class ValidateRunHandler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ValidateRunHandler.name);

  constructor(
    private readonly boss: BossService,
    private readonly validator: ValidatorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work<ValidateRunJob>(
      QUEUES.validateRun,
      async (jobs) => {
        for (const job of jobs) {
          const { runId, storeId } = job.data;
          try {
            const verdict = await this.validator.validateStoredRun(runId, storeId);
            this.logger.log(
              `${storeId}: run ${runId} validated as ${verdict.status} (${verdict.findings.length} findings)`,
            );
            if (verdict.status === "ok") {
              await this.validator.updateBaseline(storeId);
            }
          } catch (err) {
            this.logger.error(
              `${storeId}: validation failed for run ${runId} -- ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
      { batchSize: 1 },
    );
  }
}
