import { z } from "zod";

/**
 * The output contract every fleet member must emit, Studio collector or HTTP
 * puller alike. Scraper creation prompts instruct the AI to produce exactly
 * these fields, and the validator enforces it on every delivered run.
 */
export const priceRecordSchema = z.object({
  product_key: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
  currency: z.string().length(3),
  unit: z.string().min(1),
  in_stock: z.boolean(),
  url: z.url(),
  observed_at: z.iso.datetime(),
});
export type PriceRecord = z.infer<typeof priceRecordSchema>;

/** POST /api/ingest/:scraperId, authenticated by the X-Webhook-Secret header. */
export const ingestBodySchema = z.array(priceRecordSchema);
export type IngestBody = z.infer<typeof ingestBodySchema>;

export const ingestResponseSchema = z.object({
  accepted: z.number().int(),
  runId: z.string().nullable(),
});
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
