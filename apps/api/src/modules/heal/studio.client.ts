import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Env } from "../../config/env.schema.js";

const BD_API = "https://api.brightdata.com";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

export interface HealProgressResult {
  id: string;
  status: "pending_answer" | "running" | "done" | "error" | string;
  step: string;
  completedSteps: string[];
  diff: {
    template_a: unknown;
    template_b: unknown;
    title: string;
  } | null;
  previewResult: unknown[] | null;
  success: boolean | null;
}

/**
 * Wraps the Bright Data Scraper Studio surface used by the heal loop:
 * refactor_template to propose a diff, resume_automation_job to approve it.
 *
 * Every method here spends credits, so every call site goes through HealBudget
 * first.
 */
@Injectable()
export class StudioClient {
  private readonly logger = new Logger(StudioClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get apiKey(): string {
    const key = this.config.get("BRIGHTDATA_API_KEY", { infer: true });
    if (!key) throw new Error("BRIGHTDATA_API_KEY is not configured");
    return key;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Trigger a heal and poll until the approval gate (pending_answer) or
   * timeout. Returns the progress snapshot that contains the diff and preview.
   */
  async proposeHeal(collectorId: string, prompt: string): Promise<HealProgressResult> {
    this.logger.log(`${collectorId}: triggering heal -- ${prompt.slice(0, 80)}...`);

    const triggerRes = await fetch(
      `${BD_API}/dca/collectors/${collectorId}/refactor_template`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ prompt }),
      },
    );

    if (!triggerRes.ok) {
      const text = await triggerRes.text();
      throw new StudioHealError(
        `Failed to trigger heal for ${collectorId}: ${triggerRes.status} ${text}`,
      );
    }

    return this.pollProgress(collectorId);
  }

  /**
   * Single-shot progress check. Does NOT loop -- returns immediately.
   * Used by the status endpoint for live polling from the frontend.
   */
  async checkProgress(collectorId: string): Promise<HealProgressResult> {
    const res = await fetch(
      `${BD_API}/dca/collectors/${collectorId}/refactor_template/progress`,
      { headers: this.headers() },
    );

    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`${collectorId}: progress check ${res.status} -- ${text}`);
      return {
        id: "",
        status: "error",
        step: "unknown",
        completedSteps: [],
        diff: null,
        previewResult: null,
        success: false,
      };
    }

    return this.parseProgress(await res.json() as Record<string, unknown>);
  }

  private parseProgress(data: Record<string, unknown>): HealProgressResult {
    const status = String(data.status ?? "unknown");
    const step = String(data.step ?? "unknown");
    const completedSteps = Array.isArray(data.completed_steps)
      ? (data.completed_steps as string[])
      : [];

    if (status === "pending_answer" || status === "user_approval") {
      return {
        id: String(data.id ?? ""),
        status: "pending_answer",
        step,
        completedSteps,
        diff: (data.diff as HealProgressResult["diff"]) ?? null,
        previewResult: Array.isArray(data.preview_result) ? data.preview_result : null,
        success: data.success === true,
      };
    }

    if (status === "done") {
      return {
        id: String(data.id ?? ""),
        status: "done",
        step,
        completedSteps,
        diff: null,
        previewResult: Array.isArray(data.preview_result) ? data.preview_result : null,
        success: data.success === true,
      };
    }

    if (status === "error" || status === "failed") {
      return {
        id: String(data.id ?? ""),
        status: "error",
        step,
        completedSteps,
        diff: null,
        previewResult: null,
        success: false,
      };
    }

    return {
      id: String(data.id ?? ""),
      status: status as string,
      step,
      completedSteps,
      diff: null,
      previewResult: null,
      success: null,
    };
  }

  /**
   * Poll refactor_template/progress until a terminal state or timeout.
   */
  private async pollProgress(collectorId: string): Promise<HealProgressResult> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      const res = await fetch(
        `${BD_API}/dca/collectors/${collectorId}/refactor_template/progress`,
        { headers: this.headers() },
      );

      if (!res.ok) {
        const text = await res.text();
        this.logger.warn(`${collectorId}: progress poll ${res.status} -- ${text}`);
        continue;
      }

      const data = (await res.json()) as Record<string, unknown>;
      const result = this.parseProgress(data);

      this.logger.debug(`${collectorId}: step=${result.step} status=${result.status}`);

      if (
        result.status === "pending_answer" ||
        result.status === "done" ||
        result.status === "error"
      ) {
        return result;
      }
    }

    this.logger.warn(`${collectorId}: heal timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    return {
      id: "",
      status: "timeout" as string,
      step: "timeout",
      completedSteps: [],
      diff: null,
      previewResult: null,
      success: false,
    };
  }

  /** Approve the pending heal diff and save to production. */
  async approve(collectorId: string): Promise<void> {
    this.logger.log(`${collectorId}: approving heal`);
    const res = await fetch(
      `${BD_API}/dca/collectors/${collectorId}/resume_automation_job`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ message: true, auto_save: true }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new StudioHealError(
        `Failed to approve heal for ${collectorId}: ${res.status} ${text}`,
      );
    }
  }

  /** Reject the pending heal diff. Scraper stays unchanged. */
  async reject(collectorId: string): Promise<void> {
    this.logger.log(`${collectorId}: rejecting heal`);
    const res = await fetch(
      `${BD_API}/dca/collectors/${collectorId}/resume_automation_job`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ message: false }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new StudioHealError(
        `Failed to reject heal for ${collectorId}: ${res.status} ${text}`,
      );
    }
  }
}

export class StudioHealError extends Error {
  override readonly name = "StudioHealError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
