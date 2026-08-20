import { Module } from "@nestjs/common";
import { IngestController } from "./ingest.controller.js";

@Module({ controllers: [IngestController] })
export class IngestModule {}
