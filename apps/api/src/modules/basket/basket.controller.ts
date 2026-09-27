import { Controller, Get, Query } from "@nestjs/common";
import {
  type BasketIndexResponse,
  type BasketQuery,
  type BasketRailsResponse,
  type BasketTodayResponse,
  type RailsQuery,
  basketQuerySchema,
  railsQuerySchema,
} from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { BasketService } from "./basket.service.js";

const queryPipe = new ZodValidationPipe(basketQuerySchema);
const railsPipe = new ZodValidationPipe(railsQuerySchema);

@Controller("basket")
export class BasketController {
  constructor(private readonly service: BasketService) {}

  /** GET /api/basket/index?country=US -- omit country to get every series. */
  @Get("index")
  index(@Query(queryPipe) query: BasketQuery): Promise<BasketIndexResponse> {
    return this.service.index(query.country);
  }

  /** GET /api/basket/today?country=US */
  @Get("today")
  today(@Query(queryPipe) query: BasketQuery): Promise<BasketTodayResponse> {
    return this.service.today(query.country);
  }

  /** GET /api/basket/rails?country=US&tier=core -- every pin, not just the winner. */
  @Get("rails")
  rails(@Query(railsPipe) query: RailsQuery): Promise<BasketRailsResponse> {
    return this.service.rails(query);
  }
}
