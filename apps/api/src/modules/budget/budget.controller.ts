import { Controller, Get, NotImplementedException } from "@nestjs/common";
import { type CreditBudget } from "@basketwatch/contract";
import { BudgetService } from "./budget.service.js";

@Controller("budget")
export class BudgetController {
  constructor(private readonly service: BudgetService) {}

  /** GET /api/budget */
  @Get()
  current(): Promise<CreditBudget> {
    throw new NotImplementedException("The credit meter is not reading the database yet.");
  }
}
