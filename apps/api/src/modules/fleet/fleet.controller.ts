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
}
