/**
 * Strips credentials out of text that is about to leave the process boundary:
 * log lines, error messages, incident evidence, heal prompts. The Bright Data
 * CLI is invoked as `brightdata -k <key> ...`, and Node's execFile puts the
 * whole command line into err.message -- so any error string derived from a
 * CLI failure carries the key unless it passes through here first.
 */

const ARGV_KEY = /(-k|--key)[=\s]+\S+/g;
const BEARER = /Bearer\s+\S+/gi;

export function scrubSecrets(text: string, extraSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of extraSecrets) {
    if (secret) out = out.split(secret).join("[REDACTED]");
  }
  return out.replace(ARGV_KEY, "$1 [REDACTED]").replace(BEARER, "Bearer [REDACTED]");
}

/** scrubSecrets over every string inside a JSON-ish value, shape preserved. */
export function scrubDeep<T>(value: T, extraSecrets: readonly string[] = []): T {
  if (typeof value === "string") {
    return scrubSecrets(value, extraSecrets) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubDeep(v, extraSecrets)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubDeep(v, extraSecrets);
    }
    return out as T;
  }
  return value;
}
