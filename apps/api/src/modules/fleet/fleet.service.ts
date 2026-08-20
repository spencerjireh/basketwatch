import { Injectable } from "@nestjs/common";
import { type FleetScraper } from "@basketwatch/contract";
import { FleetRepository } from "./fleet.repository.js";

@Injectable()
export class FleetService {
  constructor(private readonly repository: FleetRepository) {}

  async list(): Promise<FleetScraper[]> {
    return this.repository.findAll();
  }
}
