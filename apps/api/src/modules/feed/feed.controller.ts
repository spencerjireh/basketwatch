import { Controller, Get, Query, Sse } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { type FeedResponse, type PageQuery, feedQuerySchema } from "@basketwatch/contract";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { FeedService } from "./feed.service.js";

@Controller()
export class FeedController {
  constructor(private readonly service: FeedService) {}

  /** GET /api/feed?limit=50&cursor=... */
  @Get("feed")
  page(@Query(new ZodValidationPipe(feedQuerySchema)) query: PageQuery): Promise<FeedResponse> {
    return this.service.page(query);
  }

  /**
   * GET /api/stream -- one FeedEvent per message.
   *
   * Nest's @Sse sets the event-stream headers and keeps the connection open.
   * The heartbeat and the resume-by-id framing in common/sse land here when the
   * feed goes live; until then the stream is open but silent, which is enough
   * for the dashboard to prove its reconnect path.
   */
  @Sse("stream")
  stream(): Observable<{ id: string; type: string; data: string }> {
    return this.service.stream().pipe(
      map((event) => ({
        id: event.id,
        type: "feed",
        data: JSON.stringify(event),
      })),
    );
  }
}
