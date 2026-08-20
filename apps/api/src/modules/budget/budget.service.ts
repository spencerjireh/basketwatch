import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type CreditBudget } from "@basketwatch/contract";
import { type Env } from "../../config/env.schema.js";
import { BudgetRepository } from "./budget.repository.js";

const USD = "USD";

/**
 * The credit meter mirrors the env knobs the budget guard enforces, so the
 * dashboard shows the same ceilings that actually stop a Studio call. Credits
 * are finite and an overrun has already happened once.
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly repository: BudgetRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async current(): Promise<CreditBudget> {
    const { amount, heals } = await this.repository.spentToday();
    const dailyCeiling = this.config.get("CREDIT_DAILY_CEILING_USD", { infer: true });

    // Bright Data reports a balance the database cannot know, and its `budget
    // balance` command rounds to the dollar, so the starting figure is
    // configured rather than read. Unset, the meter falls back to the day's
    // ceiling: a smaller, safer number than a guessed account total.
    const opening = this.config.get("BD_BALANCE_USD", { infer: true }) ?? dailyCeiling;

    return {
      balance: { amount: opening - amount, currency: USD },
      spentToday: { amount, currency: USD },
      dailyCeiling: { amount: dailyCeiling, currency: USD },
      healsToday: heals,
      maxAttemptsPerIncident: this.config.get("HEAL_MAX_ATTEMPTS_PER_INCIDENT", { infer: true }),
      maxHealsPerScraperPerDay: this.config.get("HEAL_MAX_PER_SCRAPER_PER_DAY", { infer: true }),
    };
  }
}
