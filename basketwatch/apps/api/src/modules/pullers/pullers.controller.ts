import { Controller, NotImplementedException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { type PullerRunResponse, pullerRunQuerySchema } from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";

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
  @Post(":storeId/run")
  run(
    @Param("storeId") _storeId: string,
    @Query(new ZodValidationPipe(pullerRunQuerySchema)) _query: { dryRun: boolean },
  ): Promise<PullerRunResponse> {
    throw new NotImplementedException("Pullers are not implemented yet.");
  }
}
