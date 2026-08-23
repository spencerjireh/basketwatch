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

  BRIGHTDATA_API_KEY: secret(),
  BRIGHTDATA_WEBHOOK_SECRET: secret(),
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

  // The catalogue pull schedule, off by default. The first scheduled pull is
  // when this project starts writing into the one dataset it cannot
  // re-collect, so arming it is a deliberate act rather than a deploy default.
  PULL_SCHEDULE_ENABLED: boolFlag(false),
  /** Daily at 06:00 UTC, which is mid-afternoon in Manila. */
  PULL_SCHEDULE_CRON: z.string().default("0 6 * * *"),

  /**
   * The auto-heal loop, on by default: this is the behaviour the product is
   * built around, and the flag exists to stop it in a hurry rather than to
   * gate it. Off means an incident still opens and still shows on the
   * dashboard -- only the Bright Data call is skipped.
   */
  HEAL_AUTO_ENABLED: boolFlag(true),
  /**
   * The second kill switch: with auto-heal on, this decides whether a
   * proposal whose preview sample passes validation is approved by the
   * machine or held for a person. Off = today's propose-then-review flow.
   */
  HEAL_AUTO_APPROVE_ENABLED: boolFlag(true),

  HEAL_MAX_ATTEMPTS_PER_INCIDENT: z.coerce.number().int().positive().default(2),
  HEAL_MAX_PER_SCRAPER_PER_DAY: z.coerce.number().int().positive().default(5),
  CREDIT_DAILY_CEILING_USD: z.coerce.number().positive().default(5),

  // How many stores may pull at once. Capped at 4 because the drizzle pool
  // is max 4 and the HTTP path shares it; empty is normalised to undefined
  // for the same `${VAR:-}` compose reason as BD_BALANCE_USD above.
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
