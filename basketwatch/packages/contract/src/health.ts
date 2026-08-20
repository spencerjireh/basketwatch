import { z } from "zod";

/** GET /api/health -- liveness. Touches nothing; this is what Docker probes. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  uptimeSeconds: z.number(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

const checkSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});

/**
 * GET /api/health/ready -- readiness. Pings Postgres and the queue.
 *
 * Kept separate from liveness on purpose: a database blip must not convince the
 * orchestrator to kill an otherwise healthy process.
 */
export const readyResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: checkSchema,
    queue: checkSchema,
  }),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
