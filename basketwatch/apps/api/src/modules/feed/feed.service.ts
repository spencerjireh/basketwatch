import { Injectable } from "@nestjs/common";
import { type FeedEvent, type Page, type PageQuery } from "@basketwatch/contract";
import { EventsBus } from "./events.bus.js";
import { FeedRepository } from "./feed.repository.js";

@Injectable()
export class FeedService {
  constructor(
    private readonly repository: FeedRepository,
    private readonly bus: EventsBus,
  ) {}

  async page(query: PageQuery): Promise<Page<FeedEvent>> {
    return this.repository.page(query);
  }

  stream() {
    return this.bus.asObservable();
  }
}
