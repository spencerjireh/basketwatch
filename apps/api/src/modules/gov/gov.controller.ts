import { Controller, Get, Query } from "@nestjs/common";
import {
  type FuelQuery,
  type FuelResponse,
  type LpgResponse,
  type MarketsQuery,
  type MarketsResponse,
  type SrpQuery,
  type SrpResponse,
  fuelQuerySchema,
  marketsQuerySchema,
  srpQuerySchema,
} from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { GovRepository } from "./gov.repository.js";

/** Government price series: fuel, LPG, wet markets, SRPs. Read-only. */
@Controller("gov")
export class GovController {
  constructor(private readonly repository: GovRepository) {}

  /** GET /api/gov/fuel?region=NCR&product=RON 95 */
  @Get("fuel")
  fuel(@Query(new ZodValidationPipe(fuelQuerySchema)) query: FuelQuery): Promise<FuelResponse> {
    return this.repository.fuel(query.region, query.product);
  }

  /** GET /api/gov/lpg */
  @Get("lpg")
  lpg(): Promise<LpgResponse> {
    return this.repository.lpg();
  }

  /** GET /api/gov/markets?commodity=Rice */
  @Get("markets")
  markets(
    @Query(new ZodValidationPipe(marketsQuerySchema)) query: MarketsQuery,
  ): Promise<MarketsResponse> {
    return this.repository.markets(query.commodity);
  }

  /** GET /api/gov/srp?q=sardines */
  @Get("srp")
  srp(@Query(new ZodValidationPipe(srpQuerySchema)) query: SrpQuery): Promise<SrpResponse> {
    return this.repository.srp(query.q);
  }
}
