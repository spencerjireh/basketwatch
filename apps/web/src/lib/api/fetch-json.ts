import type { ZodType } from "zod";
import { errorResponseSchema } from "@basketwatch/contract";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * One fetch path for both environments, parsing every response through its
 * contract schema.
 *
 * No-store is the default rather than a framework's, because most of what this
 * fetches is live operational data and a caching default that shifts between
 * minor releases would show a stale fleet board during a demo.
 *
 * A caller that knows better can pass `next: { revalidate }`. The two are
 * spelled as a branch rather than a spread because Next rejects a request
 * carrying both `cache` and `next.revalidate`, and a silently-merged object is
 * a confusing way to find that out.
 */
export async function fetchJson<T>(
  url: string,
  schema: ZodType<T>,
  init?: RequestInit & { next?: { revalidate: number } },
): Promise<T> {
  const { next, cache, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    ...(next ? { next } : { cache: cache ?? "no-store" }),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = errorResponseSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, requestId } = parsed.data.error;
      throw new ApiError(response.status, code, message, requestId);
    }
    throw new ApiError(response.status, "internal", response.statusText, null);
  }

  const data: unknown = await response.json();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      "internal",
      `Response did not match the contract: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      null,
    );
  }
  return parsed.data;
}
