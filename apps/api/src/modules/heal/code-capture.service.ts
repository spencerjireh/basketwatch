import { Injectable, Logger } from "@nestjs/common";
import { HealRepository } from "./heal.repository.js";
import { StudioClient } from "./studio.client.js";

/**
 * Captures scraper template code via the heal-and-reject trick:
 * trigger a minimal heal, read template_a from the approval gate,
 * reject (no changes), save the template.
 *
 * Each capture costs ~$0.01-0.05 in BD credits.
 */
@Injectable()
export class CodeCaptureService {
  private readonly logger = new Logger(CodeCaptureService.name);

  constructor(
    private readonly studio: StudioClient,
    private readonly repository: HealRepository,
  ) {}

  /**
   * Capture the current template for a single scraper.
   * Returns the template JSON or null on failure.
   */
  async captureCode(scraperId: string): Promise<unknown | null> {
    this.logger.log(`${scraperId}: capturing code via heal-and-reject`);

    try {
      const progress = await this.studio.proposeHealAndWait(
        scraperId,
        "Inspect current state",
      );

      if (progress.status !== "pending_answer" || !progress.diff?.template_a) {
        this.logger.warn(
          `${scraperId}: capture failed -- status=${progress.status}, no template_a`,
        );
        try {
          await this.studio.reject(scraperId);
        } catch { /* best-effort */ }
        return null;
      }

      const template = progress.diff.template_a;

      try {
        await this.studio.reject(scraperId);
      } catch (err) {
        this.logger.warn(
          `${scraperId}: reject after capture failed -- ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await this.repository.saveTemplate(scraperId, template, "capture");
      this.logger.log(`${scraperId}: code captured and saved`);
      return template;
    } catch (err) {
      this.logger.error(
        `${scraperId}: capture error -- ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Capture code for all scrapers that have a studio_collector_id
   * but no template row yet. Runs sequentially to avoid BD rate limits.
   */
  async captureAllMissing(): Promise<{ captured: number; failed: number; skipped: number }> {
    const missing = await this.repository.findScrapersWithoutTemplate();
    this.logger.log(`Found ${missing.length} scrapers without templates`);

    let captured = 0;
    let failed = 0;

    for (const scraperId of missing) {
      const result = await this.captureCode(scraperId);
      if (result) {
        captured++;
      } else {
        failed++;
      }
    }

    this.logger.log(
      `Capture complete: ${captured} captured, ${failed} failed, ${missing.length - captured - failed} skipped`,
    );
    return { captured, failed, skipped: 0 };
  }
}
