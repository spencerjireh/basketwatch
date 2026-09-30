import { Module } from "@nestjs/common";
import { GovController } from "./gov.controller.js";
import { GovRepository } from "./gov.repository.js";

@Module({
  controllers: [GovController],
  providers: [GovRepository],
})
export class GovModule {}
