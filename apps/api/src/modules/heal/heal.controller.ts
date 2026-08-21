import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  type HealDecisionResponse,
  type HealPreviewPromptResponse,
  type HealTriggerBody,
  type HealTriggerResponse,
  healTriggerBodySchema,
} from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { HealOrchestrator } from "./heal.orchestrator.js";

@Controller("heal")
@UseGuards(OpsTokenGuard)
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
   * POST /api/heal/:scraperId/trigger
   *
   * Runs the detection-to-heal loop: looks up the scraper, composes a prompt
   * from open incidents or the request body, triggers Bright Data heal, polls
   * until the approval gate or timeout, and returns the preview.
   *
   * Long-running: blocks up to 5 minutes while the heal engine works.
   */
  @Post(":scraperId/trigger")
  trigger(
    @Param("scraperId") scraperId: string,
    @Body(new ZodValidationPipe(healTriggerBodySchema)) body: HealTriggerBody,
  ): Promise<HealTriggerResponse> {
    return this.orchestrator.trigger(scraperId, body);
  }

  /** POST /api/heal/:scraperId/approve -- approve the pending heal diff. */
  @Post(":scraperId/approve")
  approve(@Param("scraperId") scraperId: string): Promise<HealDecisionResponse> {
    return this.orchestrator.approve(scraperId);
  }

  /** POST /api/heal/:scraperId/reject -- reject the pending heal diff. */
  @Post(":scraperId/reject")
  reject(@Param("scraperId") scraperId: string): Promise<HealDecisionResponse> {
    return this.orchestrator.reject(scraperId);
  }
}
