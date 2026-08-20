import { Controller, Get, Query } from "@nestjs/common";
import {
  type BasketIndexResponse,
  type BasketTodayResponse,
  basketQuerySchema,
} from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { BasketService } from "./basket.service.js";

const queryPipe = new ZodValidationPipe(basketQuerySchema);

@Controller("basket")
export class BasketController {
  constructor(private readonly service: BasketService) {}

  /** GET /api/basket/index?country=US -- omit country to get every series. */
  @Get("index")
  index(@Query(queryPipe) query: { country?: "US" | "PH" }): Promise<BasketIndexResponse> {
    return this.service.index(query.country);
  }

  /** GET /api/basket/today?country=US */
  @Get("today")
  today(@Query(queryPipe) query: { country?: "US" | "PH" }): Promise<BasketTodayResponse> {
    return this.service.today(query.country);
  }
}
