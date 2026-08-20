import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Env } from "../../config/env.schema.js";

/**
 * The guard checked before every Studio call that costs credits.
 *
 * This is not defensive programming for its own sake: an unguarded run once
 * spent several times its ceiling in a single afternoon. Three limits, all from
 * env so they can be tightened without a deploy: attempts per incident, heals
 * per scraper per day, and a global daily spend ceiling.
 */
@Injectable()
export class HealBudget {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get maxAttemptsPerIncident(): number {
    return this.config.get("HEAL_MAX_ATTEMPTS_PER_INCIDENT", { infer: true });
  }

  get maxHealsPerScraperPerDay(): number {
    return this.config.get("HEAL_MAX_PER_SCRAPER_PER_DAY", { infer: true });
  }

  get dailyCeilingUsd(): number {
    return this.config.get("CREDIT_DAILY_CEILING_USD", { infer: true });
  }
}
