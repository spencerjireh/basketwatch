import { Module } from "@nestjs/common";
import { BasketController } from "./basket.controller.js";
import { BasketRepository } from "./basket.repository.js";
import { BasketService } from "./basket.service.js";

@Module({
  controllers: [BasketController],
  providers: [BasketService, BasketRepository],
  exports: [BasketService],
})
export class BasketModule {}
