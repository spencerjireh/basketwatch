import { Module } from "@nestjs/common";
import { BudgetController } from "./budget.controller.js";
import { BudgetRepository } from "./budget.repository.js";
import { BudgetService } from "./budget.service.js";

@Module({
  controllers: [BudgetController],
  providers: [BudgetService, BudgetRepository],
  exports: [BudgetService],
})
export class BudgetModule {}
