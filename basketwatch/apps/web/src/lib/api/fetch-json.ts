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
 * cache: "no-store" is set explicitly rather than relying on a framework
 * default. This is live operational data, and a caching default that shifts
 * between minor releases would show a stale fleet board during a demo.
 */
export async function fetchJson<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });

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
