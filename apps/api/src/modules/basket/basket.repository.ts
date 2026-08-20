import { Inject, Injectable } from "@nestjs/common";
import { type BasketItem, type BasketSeries, type Country } from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class BasketRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** One series per country; a day with no trustworthy data yields a null total. */
  async indexSeries(_country?: Country): Promise<BasketSeries[]> {
    throw new Error("not implemented");
  }

  /** Cheapest pin per canonical item: basket_map joined through latest_price. */
  async today(_country?: Country): Promise<BasketItem[]> {
    throw new Error("not implemented");
  }
}
