import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import {
  indexContributorBodySchema,
  type FleetResponse,
  type IndexContributorBody,
} from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { FleetRepository } from "./fleet.repository.js";
import { FleetService } from "./fleet.service.js";

@Controller("fleet")
export class FleetController {
  constructor(
    private readonly service: FleetService,
    private readonly repository: FleetRepository,
  ) {}

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
   * POST /api/fleet/:storeId/index-contributor
   *
   * Flip whether a store's prices count toward the country index. The index
   * filters on this flag at query time, so the flip is retroactive over the
   * store's whole history. Guarded: this is the lever that lets the
   * clone stores into the real index, so it must be a deliberate act.
   */
  @Post(":storeId/index-contributor")
  @UseGuards(OpsTokenGuard)
  async setIndexContributor(
    @Param("storeId") storeId: string,
    @Body(new ZodValidationPipe(indexContributorBodySchema)) body: IndexContributorBody,
  ): Promise<{ storeId: string; contributor: boolean }> {
    const found = await this.repository.setIndexContributor(storeId, body.contributor);
    if (!found) throw new NotFoundException(`no store ${storeId}`);
    return { storeId, contributor: body.contributor };
  }
}
