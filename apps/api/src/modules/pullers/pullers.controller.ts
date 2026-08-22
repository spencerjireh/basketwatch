import { Controller, Param, Post, Query, UseGuards } from "@nestjs/common";
import { type PullerRunResponse, pullerRunQuerySchema } from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { BossService } from "../../jobs/boss.provider.js";
import { QUEUES } from "../../jobs/queues.js";
import { PullersService } from "./pullers.service.js";

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
  ): Promise<PullerRunResponse> {
    const result = await this.service.runStore(storeId, {
      dryRun: query.dryRun,
      trigger: "manual",
    });
    if (result.runId && !query.dryRun) {
      await this.boss.send(QUEUES.validateRun, {
        runId: Number(result.runId),
        storeId,
      });
    }
    return result;
  }
}
