import { Module } from "@nestjs/common";
import { HealModule } from "../heal/heal.module.js";
import { ValidatorModule } from "../validator/validator.module.js";
import { FleetController } from "./fleet.controller.js";
import { FleetRepository } from "./fleet.repository.js";
import { FleetService } from "./fleet.service.js";
import { ProvisionService } from "./provision.service.js";

@Module({
  imports: [ValidatorModule, HealModule],
  controllers: [FleetController],
  providers: [FleetService, FleetRepository, ProvisionService],
  exports: [FleetService],
})
export class FleetModule {}
