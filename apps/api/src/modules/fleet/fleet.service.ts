import { Injectable } from "@nestjs/common";
import { type FleetScraper } from "@basketwatch/contract";
import { ValidatorService } from "../validator/validator.service.js";
import { FleetRepository } from "./fleet.repository.js";

@Injectable()
export class FleetService {
  constructor(
    private readonly repository: FleetRepository,
    private readonly validator: ValidatorService,
  ) {}

  async list(): Promise<FleetScraper[]> {
    return this.repository.findAll();
  }

  async seedBaselines(): Promise<number> {
    return this.validator.seedAllBaselines();
  }
}
