import { Injectable } from "@nestjs/common";
import { type Puller } from "./puller.types.js";

/**
 * Maps a store's crawl method to the adapter that implements it.
 *
 * Three shapes are registered: shopify, magento-graphql and sitemap. A store
 * whose method is `none` is never pulled.
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
