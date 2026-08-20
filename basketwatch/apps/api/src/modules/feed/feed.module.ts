import { Module } from "@nestjs/common";
import { EventsBus } from "./events.bus.js";
import { FeedController } from "./feed.controller.js";
import { FeedRepository } from "./feed.repository.js";
import { FeedService } from "./feed.service.js";

@Module({
  controllers: [FeedController],
  providers: [FeedService, FeedRepository, EventsBus],
  exports: [FeedService, EventsBus],
})
export class FeedModule {}
