import { Global, Module } from "@nestjs/common";
import { PullersModule } from "../modules/pullers/pullers.module.js";
import { BossService } from "./boss.provider.js";
import { FleetPullHandler } from "./handlers/fleet-pull.handler.js";

/**
 * Queue infrastructure, plus the handlers that are not owned by a single
 * domain module.
 *
 * The fleet-pull handler lives here rather than in modules/pullers because it
 * is about scheduling and fan-out; the work it fans out to is the pullers'.
 */
@Global()
@Module({
  imports: [PullersModule],
  providers: [BossService, FleetPullHandler],
  exports: [BossService],
})
export class JobsModule {}
