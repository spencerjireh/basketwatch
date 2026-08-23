import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, fetchJson } from "@/lib/api/fetch-json";

const schema = z.object({ ok: z.boolean() });

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "Service Unavailable",
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("parses a good response through the schema", async () => {
    const fetch = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchJson("http://api/thing", schema)).resolves.toEqual({ ok: true });
  });

  it("defaults to no-store so live data stays live", async () => {
    const fetch = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);

    await fetchJson("http://api/thing", schema);
    expect(fetch).toHaveBeenCalledWith("http://api/thing", { cache: "no-store" });
  });

  it("sends revalidate instead of cache when the caller asks for it", async () => {
    const fetch = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);

    await fetchJson("http://api/thing", schema, { next: { revalidate: 60 } });
    expect(fetch).toHaveBeenCalledWith("http://api/thing", { next: { revalidate: 60 } });
  });

  it("lifts the API's own error envelope into an ApiError", async () => {
    const body = {
      error: { code: "not_found", message: "no such basket", requestId: "req-42" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(404, body)));

    const error = await fetchJson("http://api/thing", schema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.code).toBe("not_found");
    expect(apiError.message).toBe("no such basket");
    expect(apiError.requestId).toBe("req-42");
  });

  it("survives a failure body that is not JSON at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(503, new Error("not json"))));

    const error = await fetchJson("http://api/thing", schema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(503);
    expect(apiError.code).toBe("internal");
    expect(apiError.requestId).toBeNull();
  });

  it("refuses a 200 that does not match the contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, { unexpected: true })));

    const error = await fetchJson("http://api/thing", schema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toMatch(/did not match the contract/);
  });
});
