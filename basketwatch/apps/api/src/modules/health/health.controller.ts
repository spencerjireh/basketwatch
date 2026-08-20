import { Controller, Get, HttpCode, Inject } from "@nestjs/common";
import {
  type HealthResponse,
  type ReadyResponse,
  healthResponseSchema,
  readyResponseSchema,
} from "@basketwatch/contract";
import { PG_SQL } from "../../database/database.tokens.js";
import { type Sql } from "../../database/database.module.js";
import { BossService } from "../../jobs/boss.provider.js";

const VERSION = process.env.npm_package_version ?? "0.0.0";
const startedAt = Date.now();

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PG_SQL) private readonly sql: Sql,
    private readonly boss: BossService,
  ) {}

  /**
   * Liveness. Touches nothing on purpose: this is what Docker probes every 15
   * seconds, and a database blip must not convince the orchestrator to kill an
   * otherwise healthy process.
   */
  @Get()
  health(): HealthResponse {
    return healthResponseSchema.parse({
      status: "ok",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: VERSION,
    });
  }

  /** Readiness. Says whether this process can actually serve a request. */
  @Get("ready")
  @HttpCode(200)
  async ready(): Promise<ReadyResponse> {
    const database = await this.pingDatabase();
    const queue = this.boss.isReady()
      ? { ok: true }
      : { ok: false, detail: "job queue not started" };

    return readyResponseSchema.parse({
      status: database.ok && queue.ok ? "ok" : "degraded",
      checks: { database, queue },
    });
  }

  private async pingDatabase(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const start = Date.now();
    try {
      await this.sql`select 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "unreachable" };
    }
  }
}
