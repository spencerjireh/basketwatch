import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  type Incident,
  type IncidentsQuery,
  type IncidentsResponse,
  incidentsQuerySchema,
} from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { IncidentsService } from "./incidents.service.js";

@Controller("incidents")
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  /** GET /api/incidents?state=open */
  @Get()
  page(
    @Query(new ZodValidationPipe(incidentsQuerySchema)) query: IncidentsQuery,
  ): Promise<IncidentsResponse> {
    return this.service.page(query);
  }

  /** GET /api/incidents/:id -- evidence and every attempt in one response. */
  @Get(":id")
  byId(@Param("id") id: string): Promise<Incident> {
    return this.service.byId(id);
  }
}
