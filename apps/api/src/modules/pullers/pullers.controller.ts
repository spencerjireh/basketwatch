import { Controller, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  type PullerRunQueuedResponse,
  type PullerRunResponse,
  pullerRunQuerySchema,
} from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { BossService } from "../../jobs/boss.provider.js";
import { QUEUES } from "../../jobs/queues.js";
import { PullersService } from "./pullers.service.js";

/**
 * The only way to ask for a catalogue pull, other than the schedule.
 *
 * A wet run is enqueued rather than executed inline, on the same queue the
 * schedule uses. That is what makes "manual" and "cron" two ways of asking for
 * one thing instead of two implementations racing each other: pg-boss holds a
 * singleton key per store, so a hand trigger cannot double-spend against the
 * nightly fan-out, and the validator is enqueued by the run itself rather than
 * by whoever happened to be watching.
 *
 * A dry run still answers inline. It writes nothing and costs nothing beyond
 * the fetch, and its whole value is telling you the answer now.
 *
 * Every route here is a write, so the guard stays at the class.
 */
@Controller("pullers")
@UseGuards(OpsTokenGuard)
export class PullersController {
  constructor(
    private readonly service: PullersService,
    private readonly boss: BossService,
  ) {}

  /**
   * POST /api/pullers/run -- the whole fleet.
   *
   * Declared before the parameterised route below, which would otherwise match
   * it with storeId="run".
   *
   * Enqueues the same fleet-pull job the cron fires, so the fan-out keeps its
   * jitter and its per-store singleton keys rather than growing a second
   * implementation here.
   */
  @Post("run")
  async runFleet(): Promise<{ status: string }> {
    await this.boss.send(QUEUES.fleetPull, {});
    return { status: "queued" };
  }

  @Post(":storeId/run")
  async run(
    @Param("storeId") storeId: string,
    @Query(new ZodValidationPipe(pullerRunQuerySchema)) query: { dryRun: boolean },
  ): Promise<PullerRunResponse | PullerRunQueuedResponse> {
    if (query.dryRun) {
      return this.service.runStore(storeId, { dryRun: true, trigger: "manual" });
    }

    // Asked of the queue directly rather than left to pg-boss's singletonKey,
    // which only dedupes on queues with a `stately` or `short` policy -- ours
    // are `standard`, where the key is recorded and otherwise ignored.
    if (await this.service.hasPendingPull(storeId)) {
      return { status: "already_queued", storeId, jobId: null };
    }

    const jobId = await this.boss.send(
      QUEUES.scrapeRun,
      { storeId, trigger: "manual" },
      // No retries: a person can press it again, and a silent retry of a
      // credit-spending job is not a favour.
      { singletonKey: storeId, retryLimit: 0 },
    );

    return { status: jobId ? "queued" : "already_queued", storeId, jobId };
  }

}
