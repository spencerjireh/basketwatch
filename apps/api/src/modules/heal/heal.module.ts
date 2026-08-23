import { Module } from "@nestjs/common";
import { ValidatorModule } from "../validator/validator.module.js";
import { CodeCaptureService } from "./code-capture.service.js";
import { HealBudget } from "./heal.budget.js";
import { HealController } from "./heal.controller.js";
import { HealOrchestrator } from "./heal.orchestrator.js";
import { HealRepository } from "./heal.repository.js";
import { StudioClient } from "./studio.client.js";

@Module({
  imports: [ValidatorModule],
  controllers: [HealController],
  providers: [HealOrchestrator, HealBudget, HealRepository, StudioClient, CodeCaptureService],
  exports: [HealOrchestrator, HealBudget, CodeCaptureService, HealRepository],
})
export class HealModule {}
