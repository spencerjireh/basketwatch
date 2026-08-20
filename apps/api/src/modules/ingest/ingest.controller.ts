import { Body, Controller, Logger, Param, Post, UseGuards } from "@nestjs/common";
import {
  type IngestBody,
  type IngestResponse,
  ingestBodySchema,
} from "@basketwatch/contract";
import { WebhookSecretGuard } from "../../common/guards/webhook-secret.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";

/**
 * Delivery endpoint for Scraper Studio.
 *
 * The public URL is https://basketwatch.spencerjireh.com/api/ingest/<scraper>,
 * and it is unchanged from what the fleet already points at: Nest's global
 * prefix is "api" and Next rewrites /api/* through without stripping.
 *
 * Persistence is not wired yet. What is wired: the secret is checked with a
 * constant-time compare, and the body is validated against the fleet output
 * contract before anything else looks at it.
 */
@Controller("ingest")
@UseGuards(WebhookSecretGuard)
export class IngestController {
  private readonly logger = new Logger(IngestController.name);

  @Post(":scraperId")
  receive(
    @Param("scraperId") scraperId: string,
    @Body(new ZodValidationPipe(ingestBodySchema)) rows: IngestBody,
  ): IngestResponse {
    this.logger.log(`ingest: ${rows.length} rows from ${scraperId}`);
    // Next: write the run, enqueue validate-run, update the baseline.
    return { accepted: rows.length, runId: null };
  }
}
