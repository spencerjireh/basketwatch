import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";

/**
 * Webhook receiver for Scraper Studio deliveries.
 * POST /ingest/:scraperId with the run payload; the shared secret in the
 * X-Webhook-Secret header must match BRIGHTDATA_WEBHOOK_SECRET.
 *
 * TODO(day 2-3): persist run, enqueue validation via pg-boss, update baseline.
 */
@Controller("ingest")
export class IngestController {
  @Post(":scraperId")
  receive(
    @Param("scraperId") scraperId: string,
    @Headers("x-webhook-secret") secret: string | undefined,
    @Body() payload: unknown,
  ) {
    if (!secret || secret !== process.env.BRIGHTDATA_WEBHOOK_SECRET) {
      throw new UnauthorizedException("invalid webhook secret");
    }
    if (!Array.isArray(payload)) {
      throw new BadRequestException("expected a JSON array of records");
    }
    console.log(`ingest: ${payload.length} rows from ${scraperId}`);
    return { accepted: payload.length };
  }
}
