import { Injectable, Logger } from "@nestjs/common";
import { type FleetScraper } from "@basketwatch/contract";
import { HealRepository } from "../heal/heal.repository.js";
import { CodeCaptureService } from "../heal/code-capture.service.js";
import { ValidatorService } from "../validator/validator.service.js";
import { FleetRepository } from "./fleet.repository.js";

@Injectable()
export class FleetService {
  private readonly logger = new Logger(FleetService.name);

  constructor(
    private readonly repository: FleetRepository,
    private readonly validator: ValidatorService,
    private readonly codeCapture: CodeCaptureService,
    private readonly healRepository: HealRepository,
  ) {}

  async list(): Promise<FleetScraper[]> {
    return this.repository.findAll();
  }

  async seedBaselines(): Promise<number> {
    return this.validator.seedAllBaselines();
  }

  async captureAllCode(): Promise<{ captured: number; failed: number; skipped: number }> {
    return this.codeCapture.captureAllMissing();
  }

  /** Fire-and-forget capture -- logs result but never throws to the caller. */
  captureOneCodeAsync(scraperId: string): void {
    this.codeCapture.captureCode(scraperId).then(
      (result) => this.logger.log(`${scraperId}: capture ${result ? "succeeded" : "failed"}`),
      (err: unknown) =>
        this.logger.error(
          `${scraperId}: capture error -- ${err instanceof Error ? err.message : String(err)}`,
        ),
    );
  }

  async hasTemplate(scraperId: string): Promise<boolean> {
    const tpl = await this.healRepository.getLatestTemplate(scraperId);
    return tpl !== null;
  }
}
