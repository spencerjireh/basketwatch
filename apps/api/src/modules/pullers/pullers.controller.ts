import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { type PullerRunResponse, pullerRunQuerySchema } from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { BossService } from "../../jobs/boss.provider.js";
import { QUEUES } from "../../jobs/queues.js";
import { PullersService, type PullProgress } from "./pullers.service.js";

/**
 * Manual trigger for a store's catalogue pull.
 *
 * Scheduled pulls go through pg-boss; this is the same work, on demand, and
 * with a dry-run switch. Guarded by the ops token because a real run costs
 * bandwidth and, for Studio-backed stores, credits.
 */
@Controller("pullers")
@UseGuards(OpsTokenGuard)
export class PullersController {
  constructor(
    private readonly service: PullersService,
    private readonly boss: BossService,
  ) {}

  @Post(":storeId/run")
  async run(
    @Param("storeId") storeId: string,
    @Query(new ZodValidationPipe(pullerRunQuerySchema)) query: { dryRun: boolean },
  ): Promise<PullerRunResponse | { status: string; storeId: string }> {
    if (query.dryRun) {
      return this.service.runStore(storeId, { dryRun: true, trigger: "manual" });
    }
    const started = this.service.startPullAsync(storeId);
    return started;
  }

  @Get(":storeId/pull-status")
  pullStatus(
    @Param("storeId") storeId: string,
  ): PullProgress | { status: "idle"; storeId: string } {
    const progress = this.service.getPullProgress(storeId);
    if (!progress) return { status: "idle" as const, storeId };
    if (progress.status === "done" || progress.status === "error") {
      this.service.clearPullProgress(storeId);
      if (progress.result?.runId) {
        this.boss.send(QUEUES.validateRun, {
          runId: Number(progress.result.runId),
          storeId,
        }).catch(() => {});
      }
    }
    return progress;
  }
}
