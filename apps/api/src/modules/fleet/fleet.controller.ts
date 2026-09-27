import { Controller, Get } from "@nestjs/common";
import { type FleetResponse } from "@basketwatch/contract";
import { FleetService } from "./fleet.service.js";

@Controller("fleet")
export class FleetController {
  constructor(private readonly service: FleetService) {}

  /** GET /api/fleet */
  @Get()
  list(): Promise<FleetResponse> {
    return this.service.list();
  }
}
