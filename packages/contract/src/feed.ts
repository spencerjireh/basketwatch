import { z } from "zod";
import { pageQuerySchema, pageSchema, timestampSchema } from "./primitives.js";

export const feedEventKinds = [
  "breakage",
  "healing",
  "healed",
  "price_drop",
  "escalation",
] as const;
export const feedEventKindSchema = z.enum(feedEventKinds);
export type FeedEventKind = z.infer<typeof feedEventKindSchema>;

/** GET /api/feed, and the payload of every SSE message on /api/stream. */
export const feedEventSchema = z.object({
  id: z.string(),
  at: timestampSchema,
  storeId: z.string().nullable(),
  storeName: z.string(),
  kind: feedEventKindSchema,
  summary: z.string(),
  /** present on breakage/healing/healed, so the feed links into the audit */
  incidentId: z.string().nullable(),
});
export type FeedEvent = z.infer<typeof feedEventSchema>;

export const feedQuerySchema = pageQuerySchema;
export const feedResponseSchema = pageSchema(feedEventSchema);
export type FeedResponse = z.infer<typeof feedResponseSchema>;
