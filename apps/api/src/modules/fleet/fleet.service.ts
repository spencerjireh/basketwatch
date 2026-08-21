import { Injectable } from "@nestjs/common";
import { type FleetScraper } from "@basketwatch/contract";
import { CodeCaptureService } from "../heal/code-capture.service.js";
import { ValidatorService } from "../validator/validator.service.js";
import { FleetRepository } from "./fleet.repository.js";

@Injectable()
export class FleetService {
  constructor(
    private readonly repository: FleetRepository,
    private readonly validator: ValidatorService,
    private readonly codeCapture: CodeCaptureService,
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

  async captureOneCode(scraperId: string): Promise<boolean> {
    const result = await this.codeCapture.captureCode(scraperId);
    return result !== null;
  }
}
