import { Injectable } from "@nestjs/common";
import { type Puller } from "./puller.types.js";

/**
 * Maps a store's crawl method to the adapter that implements it.
 *
 * Empty until the adapters land in ./adapters. The 19 locked stores use five
 * shapes: shopify, magento-graphql, sitemap, sitemap-bounded, and none.
 */
@Injectable()
export class PullerRegistry {
  private readonly byMethod = new Map<string, Puller>();

  register(puller: Puller): void {
    this.byMethod.set(puller.method, puller);
  }

  get(method: string): Puller | undefined {
    return this.byMethod.get(method);
  }
}
