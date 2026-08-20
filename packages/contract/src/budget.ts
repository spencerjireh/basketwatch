import { z } from "zod";
import { moneySchema } from "./primitives.js";

/**
 * GET /api/budget -- the credit spend meter.
 *
 * Mirrors the budget-guard env knobs so the dashboard shows the same ceilings
 * the guard actually enforces. Credits are finite and an overrun has already
 * happened once, so this is a product surface, not a debug view.
 */
export const creditBudgetSchema = z.object({
  balance: moneySchema,
  spentToday: moneySchema,
  dailyCeiling: moneySchema,
  healsToday: z.number().int(),
  maxAttemptsPerIncident: z.number().int(),
  maxHealsPerScraperPerDay: z.number().int(),
});
export type CreditBudget = z.infer<typeof creditBudgetSchema>;
