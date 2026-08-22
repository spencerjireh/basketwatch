import { Global, Module } from "@nestjs/common";
import { HealModule } from "../modules/heal/heal.module.js";
import { PullersModule } from "../modules/pullers/pullers.module.js";
import { ValidatorModule } from "../modules/validator/validator.module.js";
import { BossService } from "./boss.provider.js";
import { FleetPullHandler } from "./handlers/fleet-pull.handler.js";
import { HealAutoHandler } from "./handlers/heal-auto.handler.js";
import { ValidateRunHandler } from "./handlers/validate-run.handler.js";

/**
 * Queue infrastructure, plus the handlers that are not owned by a single
 * domain module.
 *
 * The fleet-pull handler lives here rather than in modules/pullers because it
 * is about scheduling and fan-out; the work it fans out to is the pullers'.
 * The validate-run handler likewise: scheduling and wiring, not business logic.
 * The heal-auto handler bridges incidents to the heal orchestrator.
 */
@Global()
@Module({
  imports: [PullersModule, ValidatorModule, HealModule],
  providers: [BossService, FleetPullHandler, HealAutoHandler, ValidateRunHandler],
  exports: [BossService],
})
export class JobsModule {}
