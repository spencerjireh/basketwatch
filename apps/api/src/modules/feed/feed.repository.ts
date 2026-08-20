import { Inject, Injectable } from "@nestjs/common";
import { type FeedEvent, type PageQuery, type Page } from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

/** The only file in this module allowed to touch the Drizzle schema. */
@Injectable()
export class FeedRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Newest first, cursor-paginated over runs, incidents and alerts. */
  async page(_query: PageQuery): Promise<Page<FeedEvent>> {
    throw new Error("not implemented");
  }
}
