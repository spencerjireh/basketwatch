import { Module } from "@nestjs/common";
import { PullerRegistry } from "./puller.registry.js";
import { PullersController } from "./pullers.controller.js";

/**
 * Future home of the TypeScript pullers.
 *
 * When they land: adapters in ./adapters, one per extraction shape; a pg-boss
 * handler on the fleet-pull queue; and the schedule (2x daily) registered from
 * jobs/queues.ts. Config comes from the database, not from a JSON file.
 */
@Module({
  controllers: [PullersController],
  providers: [PullerRegistry],
  exports: [PullerRegistry],
})
export class PullersModule {}
