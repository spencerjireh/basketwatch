import { Injectable } from "@nestjs/common";
import { HealBudget } from "./heal.budget.js";
import { StudioClient } from "./studio.client.js";

/**
 * The heal loop, driven by the pg-boss "heal" queue.
 *
 * evidence -> Claude-composed prompt -> refactor_template -> auto-approve ->
 * canary run -> re-validate -> save or escalate. Every step is persisted so the
 * audit view can render the whole attempt: diagnosis, prompt, diff, canary,
 * verdict, cost.
 */
@Injectable()
export class HealOrchestrator {
  constructor(
    private readonly budget: HealBudget,
    private readonly studio: StudioClient,
  ) {}

  async handle(_incidentId: string): Promise<void> {
    throw new Error("not implemented");
  }
}
