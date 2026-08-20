import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { API_PREFIX } from "@basketwatch/contract";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  // One prefix, no exclusions. The path is byte-identical whether you curl the
  // container, go through the dashboard's rewrite in dev, or hit the public
  // domain -- which is also why the Bright Data webhook URL does not change.
  app.setGlobalPrefix(API_PREFIX);

  app.useGlobalFilters(new AllExceptionsFilter());

  // Required for the database pool and pg-boss to close cleanly.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
