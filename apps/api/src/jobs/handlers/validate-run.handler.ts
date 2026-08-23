import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { HealOrchestrator } from "../../modules/heal/heal.orchestrator.js";
import { ValidatorRepository } from "../../modules/validator/validator.repository.js";
import { ValidatorService } from "../../modules/validator/validator.service.js";
import { BossService } from "../boss.provider.js";
import { QUEUES } from "../queues.js";

type ValidateRunJob = {
  runId: number;
  storeId: string;
  /** Set when this run is a canary verifying an approved heal. */
  healAttemptId?: string;
  /** The canary died before validation could mean anything (studio failure, suppression). */
  canaryFailed?: boolean;
};

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
    private readonly validatorRepository: ValidatorRepository,
    private readonly orchestrator: HealOrchestrator,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work<ValidateRunJob>(
      QUEUES.validateRun,
      async (jobs) => {
        for (const job of jobs) {
          const { runId, storeId, healAttemptId, canaryFailed } = job.data;

          // A canary that already failed upstream skips validation entirely:
          // there is nothing to judge, only an outcome to report.
          if (healAttemptId && canaryFailed) {
            await this.reportCanary(healAttemptId, storeId, {
              ranAt: new Date().toISOString(),
              rows: 0,
              nullRatePct: 100,
              status: "broken",
            });
            continue;
          }

          try {
            const verdict = await this.validator.validateStoredRun(runId, storeId);
            this.logger.log(
              `${storeId}: run ${runId} validated as ${verdict.status} (${verdict.findings.length} findings)`,
            );
            if (verdict.status === "ok") {
              await this.validator.updateBaseline(storeId);
            }
            if (healAttemptId) {
              const stats = await this.validatorRepository.getRunStats(runId);
              await this.reportCanary(healAttemptId, storeId, {
                ranAt: new Date().toISOString(),
                rows: stats?.rows ?? 0,
                nullRatePct: stats?.nullRatePct ?? 0,
                status: verdict.status,
              });
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

  private async reportCanary(
    healAttemptId: string,
    storeId: string,
    canary: { ranAt: string; rows: number; nullRatePct: number; status: string },
  ): Promise<void> {
    try {
      await this.orchestrator.handleCanaryOutcome(healAttemptId, canary);
    } catch (err) {
      this.logger.error(
        `${storeId}: canary outcome for attempt ${healAttemptId} failed -- ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
