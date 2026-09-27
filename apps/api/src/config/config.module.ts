import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "./env.schema.js";

/**
 * `ignoreEnvFile: true` on purpose: env loading in dev is a runtime flag on the
 * dev script (`tsx --env-file-if-exists`), and in prod it is injected by
 * compose. Two mechanisms for the same job is how a stale .env silently wins.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
