import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class BudgetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Today's spend summed from runs.credits_usd and heal_attempts.credits_spent. */
  async spentToday(): Promise<{ amount: number; heals: number }> {
    // Both halves in one round trip, and both coalesced: a day with no spend
    // must read as 0.00, not as an empty meter the reader has to interpret.
    const [row] = (await this.db.execute(sql`
      select
        (
          coalesce((select sum(credits_usd) from runs where at >= current_date), 0)
          + coalesce((select sum(credits_spent) from heal_attempts where started_at >= current_date), 0)
        )::text as amount,
        (select count(*) from heal_attempts where started_at >= current_date)::text as heals
    `)) as unknown as { amount: string; heals: string }[];

    return { amount: Number(row?.amount ?? 0), heals: Number(row?.heals ?? 0) };
  }
}
