import { z } from "zod";

/**
 * One error envelope for every failure the API can produce.
 *
 * `requestId` is the same id the API logs against every line of that request,
 * so a screenshot of a broken dashboard is enough to find the cause in the log.
 */
export const apiErrorCodes = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unprocessable",
  "rate_limited",
  "not_implemented",
  "internal",
] as const;
export const apiErrorCodeSchema = z.enum(apiErrorCodes);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
