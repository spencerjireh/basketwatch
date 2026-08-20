import { Module } from "@nestjs/common";
import { HealBudget } from "./heal.budget.js";
import { HealOrchestrator } from "./heal.orchestrator.js";
import { StudioClient } from "./studio.client.js";

/** Future home of the autonomous heal loop. */
@Module({
  providers: [HealOrchestrator, HealBudget, StudioClient],
  exports: [HealOrchestrator, HealBudget],
})
export class HealModule {}
