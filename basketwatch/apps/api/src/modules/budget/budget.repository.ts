import { Inject, Injectable } from "@nestjs/common";

import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class BudgetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Today's spend summed from runs.credits_usd and heal_attempts.credits_spent. */
  async spentToday(): Promise<{ amount: number; heals: number }> {
    throw new Error("not implemented");
  }
}
