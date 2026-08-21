import { Module } from "@nestjs/common";
import { HealBudget } from "./heal.budget.js";
import { HealController } from "./heal.controller.js";
import { HealOrchestrator } from "./heal.orchestrator.js";
import { HealRepository } from "./heal.repository.js";
import { StudioClient } from "./studio.client.js";

@Module({
  controllers: [HealController],
  providers: [HealOrchestrator, HealBudget, HealRepository, StudioClient],
  exports: [HealOrchestrator, HealBudget],
})
export class HealModule {}
