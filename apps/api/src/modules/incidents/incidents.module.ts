import { Module } from "@nestjs/common";
import { IncidentsController } from "./incidents.controller.js";
import { IncidentsRepository } from "./incidents.repository.js";
import { IncidentsService } from "./incidents.service.js";

@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentsRepository],
  exports: [IncidentsService],
})
export class IncidentsModule {}
