import { Controller, Get, NotImplementedException, Param, Query } from "@nestjs/common";
import { type Incident, type IncidentsResponse, incidentsQuerySchema } from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { IncidentsService } from "./incidents.service.js";

@Controller("incidents")
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  /** GET /api/incidents?state=open */
  @Get()
  page(
    @Query(new ZodValidationPipe(incidentsQuerySchema)) _query: unknown,
  ): Promise<IncidentsResponse> {
    throw new NotImplementedException("Incidents are not reading the database yet.");
  }

  /** GET /api/incidents/:id -- evidence and every attempt in one response. */
  @Get(":id")
  byId(@Param("id") _id: string): Promise<Incident> {
    throw new NotImplementedException("Incidents are not reading the database yet.");
  }
}
