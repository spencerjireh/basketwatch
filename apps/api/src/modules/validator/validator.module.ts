import { Module } from "@nestjs/common";
import { ValidatorRepository } from "./validator.repository.js";
import { ValidatorService } from "./validator.service.js";

@Module({
  providers: [ValidatorRepository, ValidatorService],
  exports: [ValidatorService, ValidatorRepository],
})
export class ValidatorModule {}
