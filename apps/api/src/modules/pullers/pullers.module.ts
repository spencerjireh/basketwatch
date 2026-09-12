import { Module, type OnModuleInit } from "@nestjs/common";
import { MagentoGraphqlAdapter } from "./adapters/magento-graphql.adapter.js";
import { ShopifyAdapter } from "./adapters/shopify.adapter.js";
import { SitemapAdapter } from "./adapters/sitemap.adapter.js";
import { Fetcher } from "./fetcher.js";
import { PullerRegistry } from "./puller.registry.js";
import { PullersController } from "./pullers.controller.js";
import { PullersRepository } from "./pullers.repository.js";
import { PullersService } from "./pullers.service.js";

/**
 * The TypeScript pullers, ported from the Python exploration codebase that
 * preceded this repo.
 *
 * Three adapters cover the pullable stores: shopify, magento-graphql and
 * sitemap. Config is read from the `stores` table, so adding a store is a
 * row edit.
 */
@Module({
  controllers: [PullersController],
  providers: [
    PullerRegistry,
    PullersRepository,
    PullersService,
    Fetcher,
    ShopifyAdapter,
    MagentoGraphqlAdapter,
    SitemapAdapter,
  ],
  exports: [PullersService],
})
export class PullersModule implements OnModuleInit {
  constructor(
    private readonly registry: PullerRegistry,
    private readonly shopify: ShopifyAdapter,
    private readonly magento: MagentoGraphqlAdapter,
    private readonly sitemap: SitemapAdapter,
  ) {}

  onModuleInit(): void {
    for (const adapter of [this.shopify, this.magento, this.sitemap]) {
      this.registry.register(adapter);
    }
  }
}
