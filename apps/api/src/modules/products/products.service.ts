import { Injectable } from "@nestjs/common";
import { type ProductSearchQuery, type ProductSearchResponse } from "@basketwatch/contract";
import { ProductsRepository } from "./products.repository.js";

@Injectable()
export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  async search(query: ProductSearchQuery): Promise<ProductSearchResponse> {
    return this.repository.search(query);
  }
}
