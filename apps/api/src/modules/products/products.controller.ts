import { Controller, Get, Query } from "@nestjs/common";
import {
  type ProductSearchQuery,
  type ProductSearchResponse,
  productSearchQuerySchema,
} from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ProductsService } from "./products.service.js";

const queryPipe = new ZodValidationPipe(productSearchQuerySchema);

@Controller("products")
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  /** GET /api/products/search?q=rice&country=US -- the catalogue, not the basket. */
  @Get("search")
  search(@Query(queryPipe) query: ProductSearchQuery): Promise<ProductSearchResponse> {
    return this.service.search(query);
  }
}
