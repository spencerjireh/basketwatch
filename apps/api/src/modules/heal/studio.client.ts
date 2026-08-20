import { Injectable } from "@nestjs/common";

/**
 * Wraps the Bright Data Scraper Studio surface used by the heal loop:
 * refactor_template to propose a diff, resume_automation_job to approve it, a
 * canary run to verify, then save to production.
 *
 * Every method here spends credits, so every call site goes through HealBudget
 * first.
 */
@Injectable()
export class StudioClient {
  async proposeHeal(_collectorId: string, _prompt: string): Promise<string> {
    throw new Error("not implemented");
  }

  async approve(_collectorId: string): Promise<void> {
    throw new Error("not implemented");
  }

  async runCanary(_collectorId: string, _url: string): Promise<unknown[]> {
    throw new Error("not implemented");
  }
}
