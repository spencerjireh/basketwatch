import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type CreditBudget } from "@basketwatch/contract";
import { type Env } from "../../config/env.schema.js";
import { BudgetRepository } from "./budget.repository.js";

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
    throw new Error("not implemented");
  }
}
