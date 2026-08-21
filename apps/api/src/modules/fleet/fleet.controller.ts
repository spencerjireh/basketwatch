import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { type FleetResponse } from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { FleetService } from "./fleet.service.js";

@Controller("fleet")
export class FleetController {
  constructor(private readonly service: FleetService) {}

  /** GET /api/fleet */
  @Get()
  list(): Promise<FleetResponse> {
    return this.service.list();
  }

  /**
   * POST /api/fleet/seed-baselines
   *
   * Compute and store baselines for every store that has products. Run this
   * once before the first pull so the validator has something to compare
   * against.
   */
  @Post("seed-baselines")
  @UseGuards(OpsTokenGuard)
  async seedBaselines(): Promise<{ seeded: number }> {
    const count = await this.service.seedBaselines();
    return { seeded: count };
  }

  /**
   * POST /api/fleet/capture-code
   *
   * Capture scraper template code for all Studio scrapers that don't have
   * a stored template yet. Uses the heal-and-reject trick: triggers a
   * minimal heal, reads template_a, rejects. ~$0.01-0.05 per scraper.
   */
  @Post("capture-code")
  @UseGuards(OpsTokenGuard)
  async captureCode(): Promise<{ captured: number; failed: number; skipped: number }> {
    return this.service.captureAllCode();
  }
}
