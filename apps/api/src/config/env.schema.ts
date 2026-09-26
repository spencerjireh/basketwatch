import { z } from "zod";

/**
 * The single env contract for the API. Anything not listed here is not read.
 *
 * Secrets are optional because prod compose passes them as `${VAR:-}`, which is
 * an empty string when unset. The transform normalises empty to undefined.
 */
const secret = () =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Required, deliberately. The API reads on this URL; in production it is a
  // read-only role, because every write belongs to the private collector.
  DATABASE_URL: z.string().min(1),

  // The owner role, used once at boot to apply migrations and then closed.
  // Unset falls back to DATABASE_URL, which is what a single-role local
  // database wants.
  MIGRATION_DATABASE_URL: secret(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
