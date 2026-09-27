import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { type ApiErrorCode, type ErrorResponse } from "@basketwatch/contract";
import type { Request, Response } from "express";

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: "bad_request",
  [HttpStatus.UNAUTHORIZED]: "unauthorized",
  [HttpStatus.FORBIDDEN]: "forbidden",
  [HttpStatus.NOT_FOUND]: "not_found",
  [HttpStatus.CONFLICT]: "conflict",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "unprocessable",
  [HttpStatus.TOO_MANY_REQUESTS]: "rate_limited",
  [HttpStatus.NOT_IMPLEMENTED]: "not_implemented",
};

/**
 * Every failure leaves through here in the contract's envelope, carrying the
 * request id that the logs are keyed by. One shape means the dashboard has one
 * error path to render instead of guessing between Nest's default body and
 * whatever a thrown Error produced.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = String(req.id ?? res.getHeader("x-request-id") ?? "unknown");

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const code = CODE_BY_STATUS[status] ?? "internal";

    let message = "Something went wrong on our side.";
    let details: unknown;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        message = typeof record.message === "string" ? record.message : exception.message;
        details = record.details;
      }
    } else {
      // Only unexpected failures are worth a stack trace in the log.
      this.logger.error(exception);
    }

    const payload: ErrorResponse = {
      error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
    };

    res.status(status).json(payload);
  }
}
