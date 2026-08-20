import { Injectable, NotFoundException } from "@nestjs/common";
import { type Incident, type IncidentState, type Page, type PageQuery } from "@basketwatch/contract";
import { IncidentsRepository } from "./incidents.repository.js";

@Injectable()
export class IncidentsService {
  constructor(private readonly repository: IncidentsRepository) {}

  async page(query: PageQuery & { state?: IncidentState }): Promise<Page<Incident>> {
    return this.repository.page(query);
  }

  async byId(id: string): Promise<Incident> {
    const incident = await this.repository.findById(id);
    if (!incident) throw new NotFoundException(`No incident with id ${id}.`);
    return incident;
  }
}
