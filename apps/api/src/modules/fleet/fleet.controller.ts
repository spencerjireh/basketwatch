import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { type FleetResponse } from "@basketwatch/contract";
import { OpsTokenGuard } from "../../common/guards/ops-token.guard.js";
import { FleetService } from "./fleet.service.js";
import { ProvisionService, type ProvisionResult } from "./provision.service.js";

@Controller("fleet")
export class FleetController {
  constructor(
    private readonly service: FleetService,
    private readonly provision: ProvisionService,
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

  /**
   * POST /api/fleet/capture-code/:scraperId
   *
   * Fire-and-forget: starts capture in background, returns immediately.
   * Poll GET /api/fleet/capture-status/:scraperId to check completion.
   */
  @Post("capture-code/:scraperId")
  @UseGuards(OpsTokenGuard)
  captureOneCode(
    @Param("scraperId") scraperId: string,
  ): { status: string; scraperId: string } {
    this.service.captureOneCodeAsync(scraperId);
    return { status: "started", scraperId };
  }

  /** GET /api/fleet/capture-status/:scraperId */
  @Get("capture-status/:scraperId")
  @UseGuards(OpsTokenGuard)
  async captureStatus(
    @Param("scraperId") scraperId: string,
  ): Promise<{ hasTemplate: boolean; scraperId: string }> {
    const hasTemplate = await this.service.hasTemplate(scraperId);
    return { hasTemplate, scraperId };
  }

  /**
   * POST /api/fleet/provision
   *
   * Create Studio collectors for all stores that don't have one yet.
   * Reads descriptions from collector-manifest.json and shells out to
   * `brightdata scraper create`. Idempotent: stores with an existing
   * collector are skipped.
   */
  @Post("provision")
  @UseGuards(OpsTokenGuard)
  provisionAll(): Promise<ProvisionResult[]> {
    return this.provision.provisionAll();
  }

  /**
   * POST /api/fleet/:storeId/provision
   *
   * Create a Studio collector for a single store. Returns immediately if
   * the store already has a collector.
   */
  @Post(":storeId/provision")
  @UseGuards(OpsTokenGuard)
  provisionOne(@Param("storeId") storeId: string): Promise<ProvisionResult> {
    return this.provision.provisionStore(storeId);
  }

  /** GET /api/fleet/unprovisioned */
  @Get("unprovisioned")
  @UseGuards(OpsTokenGuard)
  unprovisioned(): Promise<string[]> {
    return this.provision.unprovisionedStores();
  }
}
