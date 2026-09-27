import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller.js";
import { ProductsRepository } from "./products.repository.js";
import { ProductsService } from "./products.service.js";

/**
 * Search over the catalogue.
 *
 * Its own module rather than a third method on BasketModule: different table,
 * different question, and its own cursor codec. The basket is ten curated
 * items; this is 28,000 rows nobody has curated.
 */
@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
