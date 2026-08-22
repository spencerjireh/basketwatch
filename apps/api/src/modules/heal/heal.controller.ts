import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  type HealDecisionResponse,
  type HealPreviewPromptResponse,
  type HealStatusResponse,
  type HealTriggerBody,
  type HealTriggerResponse,
  healTriggerBodySchema,
} from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { HealOrchestrator } from "./heal.orchestrator.js";

/**
 * Reads are open; writes cost credits and need the ops token.
 *
 * The split is deliberate rather than incidental. The dashboard is a no-login
 * public page, so anything it renders has to be reachable without a secret --
 * and the prompt, the diff and the live progress are the whole story worth
 * telling. What they must not come with is a button: every route below that
 * spends money is guarded one by one, so adding a route without a guard is a
 * visible omission rather than an inherited default.
 */
/**
 * Five a minute. These are the routes that spend Bright Data credits, and they
 * already require the ops token -- this is the second lock, for the case where
 * the token leaks or a script goes into a loop.
 */
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("heal")
export class HealController {
  constructor(private readonly orchestrator: HealOrchestrator) {}

  /**
   * GET /api/heal/:scraperId/preview-prompt
   *
   * Returns the auto-generated prompt the trigger would use, without
   * actually triggering a heal. Lets the dashboard show the prompt in the
   * textarea so the operator can edit before firing.
   */
  @Get(":scraperId/preview-prompt")
  previewPrompt(@Param("scraperId") scraperId: string): Promise<HealPreviewPromptResponse> {
    return this.orchestrator.previewPrompt(scraperId);
  }

  /**
   * GET /api/heal/:scraperId/status
   *
   * Single-shot progress check: returns the current BD pipeline step and
   * timing for an in-flight heal, or "idle" if nothing is running.
   * The frontend polls this every 3-5 seconds for live status.
   */
  @Get(":scraperId/status")
  status(@Param("scraperId") scraperId: string): Promise<HealStatusResponse> {
    return this.orchestrator.getStatus(scraperId);
  }

  /**
   * POST /api/heal/:scraperId/trigger
   *
   * Runs the detection-to-heal loop: looks up the scraper, composes a prompt
   * from open incidents or the request body, triggers Bright Data heal, polls
   * until the approval gate or timeout, and returns the preview.
   *
   * Long-running: blocks up to 5 minutes while the heal engine works.
   */
  @Post(":scraperId/trigger")
  @UseGuards(OpsTokenGuard)
  trigger(
    @Param("scraperId") scraperId: string,
    @Body(new ZodValidationPipe(healTriggerBodySchema)) body: HealTriggerBody,
  ): Promise<HealTriggerResponse> {
    return this.orchestrator.trigger(scraperId, body);
  }

  /** POST /api/heal/:scraperId/approve -- approve the pending heal diff. */
  @Post(":scraperId/approve")
  @UseGuards(OpsTokenGuard)
  approve(@Param("scraperId") scraperId: string): Promise<HealDecisionResponse> {
    return this.orchestrator.approve(scraperId);
  }

  /** POST /api/heal/:scraperId/reject -- reject the pending heal diff. */
  @Post(":scraperId/reject")
  @UseGuards(OpsTokenGuard)
  reject(@Param("scraperId") scraperId: string): Promise<HealDecisionResponse> {
    return this.orchestrator.reject(scraperId);
  }

  /**
   * POST /api/heal/:scraperId/recover
   *
   * Adopt an orphaned BD heal that has no local attempt record. Creates an
   * attempt and incident, persists the diff, and transitions to pending_answer
   * so the UI can approve or reject.
   */
  @Post(":scraperId/recover")
  @UseGuards(OpsTokenGuard)
  recover(@Param("scraperId") scraperId: string): Promise<HealStatusResponse> {
    return this.orchestrator.recover(scraperId);
  }
}
