import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  type DropsQuery,
  type DropsResponse,
  type ProductDetail,
  type ProductSearchQuery,
  type ProductSearchResponse,
  dropsQuerySchema,
  productSearchQuerySchema,
} from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ProductsService } from "./products.service.js";

const queryPipe = new ZodValidationPipe(productSearchQuerySchema);
const dropsPipe = new ZodValidationPipe(dropsQuerySchema);

@Controller("products")
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  /** GET /api/products/search?q=rice&country=US -- the catalogue, not the basket. */
  @Get("search")
  search(@Query(queryPipe) query: ProductSearchQuery): Promise<ProductSearchResponse> {
    return this.service.search(query);
  }

  /** GET /api/products/drops?category=grocery -- at least 10% under the 30-day median. */
  @Get("drops")
  drops(@Query(dropsPipe) query: DropsQuery): Promise<DropsResponse> {
    return this.service.drops(query);
  }

  /** GET /api/products/:storeId/:productKey -- declared after the fixed paths above. */
  @Get(":storeId/:productKey")
  detail(
    @Param("storeId") storeId: string,
    @Param("productKey") productKey: string,
  ): Promise<ProductDetail> {
    return this.service.detail(storeId, productKey);
  }
}
