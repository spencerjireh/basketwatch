import { Module } from "@nestjs/common";
import { FleetController } from "./fleet.controller.js";
import { FleetRepository } from "./fleet.repository.js";
import { FleetService } from "./fleet.service.js";

@Module({
  controllers: [FleetController],
  providers: [FleetService, FleetRepository],
  exports: [FleetService],
})
export class FleetModule {}
