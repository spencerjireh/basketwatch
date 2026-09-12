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

/**
 * A boolean read from its text, never from its truthiness.
 *
 * `z.coerce.boolean()` is `Boolean(v)`, and `Boolean("false")` is `true` -- so
 * the compose default `${PULL_SCHEDULE_ENABLED:-false}`, which is always a
 * non-empty string, armed the catalogue schedule on every deploy for two days
 * before anyone noticed. Unset and empty fall back; anything else must say so
 * in words, and an unrecognised value is a boot error rather than a guess.
 */
const TRUE_WORDS = ["true", "1", "yes", "on"] as const;
const FALSE_WORDS = ["false", "0", "no", "off"] as const;

const boolFlag = (fallback: boolean) =>
  z
    .preprocess(
      (v) => (v === "" || v === undefined ? undefined : String(v).trim().toLowerCase()),
      z.enum([...TRUE_WORDS, ...FALSE_WORDS]).optional(),
    )
    .transform((v) => (v === undefined ? fallback : (TRUE_WORDS as readonly string[]).includes(v)));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Required, deliberately. The previous implementation degraded to a silent
  // no-op when this was missing, which made "the job queue is not running" a
  // valid startup state. Fail at boot instead.
  DATABASE_URL: z.string().min(1),

  RESEND_API_KEY: secret(),
  TELEGRAM_BOT_TOKEN: secret(),
  TELEGRAM_CHAT_ID: secret(),
  OPS_TOKEN: secret(),

  // The catalogue pull schedule, off by default. The first scheduled pull is
  // when this project starts writing into the one dataset it cannot
  // re-collect, so arming it is a deliberate act rather than a deploy default.
  PULL_SCHEDULE_ENABLED: boolFlag(false),
  /** Daily at 06:00 UTC, which is mid-afternoon in Manila. */
  PULL_SCHEDULE_CRON: z.string().default("0 6 * * *"),

  // How many stores may pull at once. Capped at 4 because the drizzle pool
  // is max 4 and the HTTP path shares it. Empty is normalised to undefined
  // before coercion: prod compose passes `${VAR:-}`, and z.coerce.number()
  // reads "" as 0.
  SCRAPE_CONCURRENCY: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).max(4).default(3),
  ),
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
