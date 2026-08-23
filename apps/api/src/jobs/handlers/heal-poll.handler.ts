import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { HealBudget } from "../../modules/heal/heal.budget.js";
import { HealOrchestrator, type HealPollJob } from "../../modules/heal/heal.orchestrator.js";
import { HealRepository } from "../../modules/heal/heal.repository.js";
import { BossService } from "../boss.provider.js";
import { QUEUES } from "../queues.js";

/** Grace given to attempts found at boot: long enough for one real check. */
const SWEEP_DEADLINE_MS = 2 * 60 * 1000;

/**
 * Runs the poll chain that watches in-flight Bright Data heals. Each job is
 * one tick; the orchestrator decides whether to judge, requeue, or settle.
 *
 * The boot sweep is what makes restarts safe: pg-boss keeps queued ticks
 * across a deploy, but an attempt proposed before this loop existed -- or
 * whose chain died with the process mid-tick -- has nobody watching it. Every
 * verdict-less attempt gets a fresh link at boot; duplicates are harmless
 * because a settled attempt makes any tick a no-op, and the verdict claim is
 * compare-and-set.
 */
@Injectable()
export class HealPollHandler implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealPollHandler.name);

  constructor(
    private readonly boss: BossService,
    private readonly orchestrator: HealOrchestrator,
    private readonly repository: HealRepository,
    private readonly budget: HealBudget,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work<HealPollJob>(
      QUEUES.healPoll,
      async (jobs) => {
        for (const job of jobs) {
          try {
            await this.orchestrator.pollTick(job.data);
          } catch (err) {
            // A thrown tick must not kill the chain silently: the boot sweep
            // will re-cover the attempt on the next restart, but log loudly.
            this.logger.error(
              `${job.data.scraperId}: poll tick failed -- ` +
                (err instanceof Error ? err.message : String(err)),
            );
          }
        }
      },
      { batchSize: 1 },
    );

    if (!this.budget.autoApproveEnabled) {
      this.logger.log(
        "auto-approve is disarmed (HEAL_AUTO_APPROVE_ENABLED=false); " +
          "proposals wait at the gate for a person, as before",
      );
      return;
    }

    const pending = await this.repository.listPendingAttempts();
    for (const attempt of pending) {
      await this.boss.send(
        QUEUES.healPoll,
        {
          scraperId: attempt.scraperId,
          storeId: attempt.storeId,
          incidentId: attempt.incidentId,
          attemptId: attempt.attemptId,
          expiresAt: new Date(Date.now() + SWEEP_DEADLINE_MS).toISOString(),
          errors: 0,
        } satisfies HealPollJob,
        { startAfter: 10, retryLimit: 0 },
      );
      this.logger.log(
        `${attempt.scraperId}: boot sweep enqueued heal-poll for attempt ${attempt.attemptId}`,
      );
    }
  }
}
