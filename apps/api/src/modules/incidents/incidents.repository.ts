import { Inject, Injectable } from "@nestjs/common";
import {
  type Incident,
  type IncidentState,
  type Page,
  type PageQuery,
} from "@basketwatch/contract";
import { DRIZZLE } from "../../database/database.tokens.js";
import { type Db } from "../../database/database.module.js";

/**
 * The only file in this module allowed to touch the Drizzle schema.
 *
 * Note when implementing: HealAttempt in the contract carries attempt,
 * startedAt, finishedAt and canary, and the heal_attempts table has none of
 * those columns -- it holds only created_at. That gap is item 1 of migration
 * 0001, and it will surface here as a type error rather than as a blank audit
 * panel during the demo.
 */
@Injectable()
export class IncidentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async page(_query: PageQuery & { state?: IncidentState }): Promise<Page<Incident>> {
    throw new Error("not implemented");
  }

  async findById(_id: string): Promise<Incident | null> {
    throw new Error("not implemented");
  }
}
