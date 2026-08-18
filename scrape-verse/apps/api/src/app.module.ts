import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { IngestController } from "./ingest/ingest.controller.js";
import { JobsService } from "./jobs/jobs.service.js";

@Module({
  controllers: [HealthController, IngestController],
  providers: [JobsService],
})
export class AppModule {}
