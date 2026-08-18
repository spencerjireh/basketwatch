import { Hono } from "hono";

/**
 * Webhook receiver for Scraper Studio deliveries.
 * POST /ingest/:scraperId with the run payload; the shared secret in the
 * X-Webhook-Secret header must match BRIGHTDATA_WEBHOOK_SECRET.
 *
 * TODO(day 1-2): persist run, enqueue validation, update baseline.
 */
export const ingest = new Hono();

ingest.post("/:scraperId", async (c) => {
  const secret = c.req.header("x-webhook-secret");
  if (!secret || secret !== process.env.BRIGHTDATA_WEBHOOK_SECRET) {
    return c.json({ error: "invalid webhook secret" }, 401);
  }
  const scraperId = c.req.param("scraperId");
  const payload = await c.req.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return c.json({ error: "expected a JSON array of records" }, 400);
  }
  console.log(`ingest: ${payload.length} rows from ${scraperId}`);
  return c.json({ accepted: payload.length });
});
