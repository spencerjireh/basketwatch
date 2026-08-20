import { Module } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";

/**
 * Structured logging.
 *
 * The reason this earns a dependency over Nest's built-in JSON logger: pino
 * propagates a per-request id through AsyncLocalStorage, so every line emitted
 * inside a request carries the same reqId without anyone threading a context
 * object through five call frames. The API's error envelope returns that same
 * id, which makes a screenshot of a broken dashboard enough to find the cause.
 */
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        genReqId: (req, res) => {
          const existing = req.headers["x-request-id"];
          const id = typeof existing === "string" && existing ? existing : randomUUID();
          res.setHeader("x-request-id", id);
          return id;
        },
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { singleLine: true } }
            : undefined,
        // A 15s Docker healthcheck otherwise drowns everything else in the log.
        autoLogging: { ignore: (req) => req.url === "/api/health" },
        // Not optional. Without it every ingest call writes the webhook secret
        // into the log, permanently.
        redact: {
          paths: [
            "req.headers.authorization",
            'req.headers["x-webhook-secret"]',
            "req.headers.cookie",
          ],
          remove: true,
        },
      },
    }),
  ],
})
export class LoggerModule {}
