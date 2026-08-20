import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";
import { type FeedEvent } from "@basketwatch/contract";

/**
 * In-process fan-out from whatever produces events to every open SSE stream.
 *
 * One process today, so a Subject is enough. If the API is ever scaled to more
 * than one replica this becomes a Postgres LISTEN/NOTIFY subscription and
 * nothing downstream changes -- which is why publishers depend on this class
 * rather than on rxjs directly.
 */
@Injectable()
export class EventsBus {
  private readonly subject = new Subject<FeedEvent>();

  publish(event: FeedEvent): void {
    this.subject.next(event);
  }

  asObservable() {
    return this.subject.asObservable();
  }
}
