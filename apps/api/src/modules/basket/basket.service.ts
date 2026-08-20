import { Injectable } from "@nestjs/common";
import {
  type BasketItem,
  type BasketSeries,
  type Country,
  type Rail,
  type RailsQuery,
} from "@basketwatch/contract";
import { BasketRepository } from "./basket.repository.js";

@Injectable()
export class BasketService {
  constructor(private readonly repository: BasketRepository) {}

  async index(country?: Country): Promise<BasketSeries[]> {
    return this.repository.indexSeries(country);
  }

  async today(country?: Country): Promise<BasketItem[]> {
    return this.repository.today(country);
  }

  async rails(query: RailsQuery): Promise<Rail[]> {
    return this.repository.rails(query.country, query.tier);
  }
}
