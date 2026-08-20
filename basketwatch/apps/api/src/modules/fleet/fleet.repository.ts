import { Inject, Injectable } from "@nestjs/common";
import { type FleetScraper } from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

/**
 * The only file in this module allowed to touch the Drizzle schema.
 *
 * Repositories return contract types, never raw rows: `numeric` arrives as a
 * string and runs.status uses an older vocabulary, and both are translated by
 * database/mappers before anything leaves here.
 */
@Injectable()
export class FleetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findAll(): Promise<FleetScraper[]> {
    // Reads stores left-joined to their latest run, with nullRatePct and
    // healsToday derived from runs, baselines and heal_attempts.
    throw new Error("not implemented");
  }
}
