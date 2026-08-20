import { z } from "zod";

/**
 * The single env contract for the API. Anything not listed here is not read.
 *
 * Secrets are optional because prod compose passes them as `${VAR:-}`, which is
 * an empty string when unset. The transform normalises empty to undefined so
 * "is Telegram configured?" is one truthiness check rather than two.
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

  // Required, deliberately. The previous implementation degraded to a silent
  // no-op when this was missing, which made "the job queue is not running" a
  // valid startup state. Fail at boot instead.
  DATABASE_URL: z.string().min(1),

  BRIGHTDATA_API_KEY: secret(),
  BRIGHTDATA_WEBHOOK_SECRET: secret(),
  ANTHROPIC_API_KEY: secret(),
  RESEND_API_KEY: secret(),
  TELEGRAM_BOT_TOKEN: secret(),
  TELEGRAM_CHAT_ID: secret(),
  OPS_TOKEN: secret(),

  // What the account held when we last looked. Bright Data's own `budget
  // balance` rounds to the dollar, so the meter starts from a figure the team
  // sets deliberately and subtracts recorded spend from it.
  //
  // Empty is normalised to undefined before coercion: prod compose passes
  // `${BD_BALANCE_USD:-}`, and z.coerce.number() reads "" as 0, which would
  // put the meter at zero credits rather than at "not configured".
  BD_BALANCE_USD: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().optional(),
  ),

  HEAL_MAX_ATTEMPTS_PER_INCIDENT: z.coerce.number().int().positive().default(3),
  HEAL_MAX_PER_SCRAPER_PER_DAY: z.coerce.number().int().positive().default(5),
  CREDIT_DAILY_CEILING_USD: z.coerce.number().positive().default(5),
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
