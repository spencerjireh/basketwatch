import { Module } from "@nestjs/common";
import { ValidatorModule } from "../validator/validator.module.js";
import { FleetController } from "./fleet.controller.js";
import { FleetRepository } from "./fleet.repository.js";
import { FleetService } from "./fleet.service.js";

@Module({
  imports: [ValidatorModule],
  controllers: [FleetController],
  providers: [FleetService, FleetRepository],
  exports: [FleetService],
})
export class FleetModule {}
