import { Injectable, NotFoundException } from "@nestjs/common";
import {
  type DropsQuery,
  type DropsResponse,
  type ProductDetail,
  type ProductSearchQuery,
  type ProductSearchResponse,
} from "@basketwatch/contract";
import { ProductsRepository } from "./products.repository.js";

@Injectable()
export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  async search(query: ProductSearchQuery): Promise<ProductSearchResponse> {
    return this.repository.search(query);
  }

  async drops(query: DropsQuery): Promise<DropsResponse> {
    return this.repository.drops(query);
  }

  async detail(storeId: string, productKey: string): Promise<ProductDetail> {
    const found = await this.repository.detail(storeId, productKey);
    if (!found) throw new NotFoundException(`no product ${storeId}/${productKey}`);
    return found;
  }
}
