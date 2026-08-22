import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  type CheckResult,
  type HealDecisionResponse,
  type HealDiff,
  type HealPreviewPromptResponse,
  type HealStatusResponse,
  type HealTriggerBody,
  type HealTriggerResponse,
  type IncidentContext,
  type IncidentEvidence,
} from "@basketwatch/contract";
import { HealBudget } from "./heal.budget.js";
import { HealRepository } from "./heal.repository.js";
import { buildHealPrompt, findingsToFields } from "./prompt.js";
import { StudioClient, StudioHealError } from "./studio.client.js";

@Injectable()
export class HealOrchestrator {
  private readonly logger = new Logger(HealOrchestrator.name);

  constructor(
    private readonly budget: HealBudget,
    private readonly studio: StudioClient,
    private readonly repository: HealRepository,
  ) {}

  // -----------------------------------------------------------------------
  // Preview prompt
  // -----------------------------------------------------------------------

  async previewPrompt(scraperId: string): Promise<HealPreviewPromptResponse> {
    const scraper = await this.repository.findScraperWithStore(scraperId);
    if (!scraper) throw new NotFoundException(`Scraper ${scraperId} not found.`);

    const { prompt, findings } = await this.resolvePrompt(scraperId, {});
    const incident = await this.buildIncidentContext(scraperId);
    const rawTemplate = await this.repository.getLatestTemplate(scraperId);
    let currentTemplate: Record<string, unknown>[] | null = null;
    if (rawTemplate && typeof rawTemplate === "object") {
      if (Array.isArray(rawTemplate)) {
        currentTemplate = rawTemplate as Record<string, unknown>[];
      } else {
        const obj = rawTemplate as Record<string, unknown>;
        if (Array.isArray(obj.steps)) {
          currentTemplate = obj.steps as Record<string, unknown>[];
        }
      }
    }
    return { scraperId, prompt, findings, incident, currentTemplate };
  }

  // -----------------------------------------------------------------------
  // Status (single-poll for live progress)
  // -----------------------------------------------------------------------

  async getStatus(scraperId: string): Promise<HealStatusResponse> {
    const scraper = await this.repository.findScraperWithStore(scraperId);
    if (!scraper) throw new NotFoundException(`Scraper ${scraperId} not found.`);

    const pending = await this.repository.findPendingAttemptWithTiming(scraperId);
    if (!pending) {
      // No local attempt -- check if BD has an orphaned heal awaiting approval
      try {
        const orphanCheck = await this.studio.checkProgress(scraperId);
        if (orphanCheck.status === "pending_answer" && orphanCheck.diff) {
          return {
            scraperId,
            status: "orphaned" as const,
            attemptId: null,
            incidentId: null,
            step: null,
            completedSteps: [],
            startedAt: null,
            elapsedMs: null,
            previewResult: orphanCheck.previewResult,
            diffSummary: orphanCheck.diff?.title ?? null,
            diff: orphanCheck.diff as HealDiff,
          };
        }
      } catch {
        // BD unreachable or no collector -- treat as idle
      }
      return {
        scraperId,
        status: "idle",
        attemptId: null,
        incidentId: null,
        step: null,
        completedSteps: [],
        startedAt: null,
        elapsedMs: null,
        previewResult: null,
        diffSummary: null,
      };
    }

    const progress = await this.studio.checkProgress(scraperId);
    const now = Date.now();
    const startMs = new Date(pending.startedAt).getTime();

    // When BD reaches pending_answer, persist the diff so approve/reject can
    // use it even if a later status poll no longer returns it.
    if (progress.status === "pending_answer" && progress.diff) {
      await this.repository
        .updateAttemptDiff(pending.attemptId, JSON.stringify(progress.diff))
        .catch((err: unknown) => {
          this.logger.warn(`Failed to persist diff: ${err instanceof Error ? err.message : String(err)}`);
        });
    }

    // If BD says error/done while we still have a pending attempt, close it.
    if (progress.status === "error" || progress.status === "done") {
      await this.repository.finishAttempt(pending.attemptId, "failed", null, null);
      await this.repository.reopenIncident(pending.incidentId);
    }

    const base: HealStatusResponse = {
      scraperId,
      status: progress.status === "pending_answer" ? "pending_answer"
        : progress.status === "error" ? "error"
        : progress.status === "done" ? "idle"
        : "running",
      attemptId: pending.attemptId,
      incidentId: pending.incidentId,
      step: progress.step,
      completedSteps: progress.completedSteps,
      startedAt: pending.startedAt,
      elapsedMs: now - startMs,
      previewResult: progress.previewResult,
      diffSummary: progress.diff?.title ?? null,
    };

    if (progress.status === "pending_answer" && progress.diff) {
      base.diff = progress.diff as HealDiff;
    }

    return base;
  }

  // -----------------------------------------------------------------------
  // Trigger
  // -----------------------------------------------------------------------

  async trigger(scraperId: string, body: HealTriggerBody): Promise<HealTriggerResponse> {
    const startedAt = Date.now();

    const scraper = await this.repository.findScraperWithStore(scraperId);
    if (!scraper) throw new NotFoundException(`Scraper ${scraperId} not found.`);

    await this.checkBudget(scraperId);

    const { prompt, findings } = await this.resolvePrompt(scraperId, body);
    if (!prompt) {
      throw new BadRequestException(
        "No issues detected and no prompt provided. " +
          "Pass a prompt in the request body or ensure an open incident exists.",
      );
    }

    const incidentId = await this.ensureIncident(scraperId, scraper.store_id, findings);
    const attemptNumber = (await this.repository.attemptCount(incidentId)) + 1;

    const diagnosis = findings.length > 0
      ? findings.map((f) => `[${f.check}/${f.severity}] ${f.detail}`).join("; ")
      : "Manual trigger";

    const attemptId = await this.repository.recordAttempt(
      incidentId,
      attemptNumber,
      diagnosis,
      prompt,
    );

    this.logger.log(
      `${scraperId}: heal attempt ${attemptNumber} -- ${prompt.slice(0, 80)}...`,
    );

    try {
      await this.studio.proposeHeal(scraperId, prompt);
    } catch (err) {
      this.logger.error(
        `${scraperId}: heal trigger failed -- ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.repository.finishAttempt(attemptId, "failed", null, null);
      await this.repository.reopenIncident(incidentId);
      return {
        attemptId,
        scraperId,
        storeId: scraper.store_id,
        incidentId,
        prompt,
        findings,
        status: "error" as const,
        previewResult: null,
        diffSummary: null,
        diff: null,
        durationMs: Date.now() - startedAt,
      };
    }

    // Trigger succeeded -- BD is processing asynchronously.
    // Frontend will poll GET /heal/:scraperId/status for progress updates.
    return {
      attemptId,
      scraperId,
      storeId: scraper.store_id,
      incidentId,
      prompt,
      findings,
      status: "running" as const,
      previewResult: null,
      diffSummary: null,
      diff: null,
      durationMs: Date.now() - startedAt,
    };
  }

  // -----------------------------------------------------------------------
  // Approve / Reject
  // -----------------------------------------------------------------------

  async approve(scraperId: string): Promise<HealDecisionResponse> {
    const pending = await this.repository.findPendingAttempt(scraperId);
    if (!pending) {
      throw new NotFoundException(`No pending heal attempt for scraper ${scraperId}.`);
    }

    try {
      await this.studio.approve(scraperId);
    } catch (err) {
      if (err instanceof StudioHealError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    // Fetch diff from DB first; if missing, grab it from BD before approving
    let storedDiff = await this.repository.getAttemptDiff(pending.attemptId);
    if (!storedDiff) {
      try {
        const progress = await this.studio.checkProgress(scraperId);
        if (progress.diff) {
          storedDiff = JSON.stringify(progress.diff);
          await this.repository.updateAttemptDiff(pending.attemptId, storedDiff);
        }
      } catch { /* best-effort */ }
    }

    await this.repository.finishAttempt(pending.attemptId, "approved", null, null);
    await this.repository.resolveIncident(pending.incidentId);

    if (storedDiff) {
      try {
        const parsed = JSON.parse(storedDiff) as { template_b?: unknown };
        if (parsed.template_b) {
          await this.repository.saveTemplate(
            scraperId, parsed.template_b, "heal_approved", pending.attemptId,
          );
          this.logger.log(`${scraperId}: template_b saved to scraper_templates`);
        }
      } catch { /* diff not parseable, skip template save */ }
    }

    this.logger.log(`${scraperId}: heal approved (attempt ${pending.attemptId})`);
    return {
      scraperId,
      attemptId: pending.attemptId,
      verdict: "approved",
    };
  }

  /**
   * Reject or force-cancel a heal. Best-effort BD reject -- if BD hasn't
   * reached pending_answer yet the API call may 4xx, but we still mark the
   * attempt failed and reopen the incident so the UI isn't stuck.
   */
  async reject(scraperId: string): Promise<HealDecisionResponse> {
    const pending = await this.repository.findPendingAttempt(scraperId);
    if (!pending) {
      throw new NotFoundException(`No pending heal attempt for scraper ${scraperId}.`);
    }

    try {
      await this.studio.reject(scraperId);
    } catch (err) {
      this.logger.warn(
        `${scraperId}: BD reject failed (may still be running) -- ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    await this.repository.finishAttempt(pending.attemptId, "rejected", null, null);
    await this.repository.reopenIncident(pending.incidentId);

    this.logger.log(`${scraperId}: heal rejected/cancelled (attempt ${pending.attemptId})`);
    return {
      scraperId,
      attemptId: pending.attemptId,
      verdict: "rejected",
    };
  }

  // -----------------------------------------------------------------------
  // Recover orphaned heal
  // -----------------------------------------------------------------------

  async recover(scraperId: string): Promise<HealStatusResponse> {
    const scraper = await this.repository.findScraperWithStore(scraperId);
    if (!scraper) throw new NotFoundException(`Scraper ${scraperId} not found.`);

    const progress = await this.studio.checkProgress(scraperId);
    if (progress.status !== "pending_answer" || !progress.diff) {
      throw new BadRequestException(
        "No orphaned heal found on Bright Data for this scraper.",
      );
    }

    const storeId = scraper.store_id;
    const incidentId = await this.ensureIncident(scraperId, storeId, []);
    const attemptNumber = (await this.repository.attemptCount(incidentId)) + 1;

    const attemptId = await this.repository.recordAttempt(
      incidentId,
      attemptNumber,
      "Recovered orphaned BD heal",
      "Recovered from orphaned Bright Data heal",
    );

    if (progress.diff) {
      await this.repository
        .updateAttemptDiff(attemptId, JSON.stringify(progress.diff))
        .catch((err: unknown) => {
          this.logger.warn(`Failed to persist recovered diff: ${err instanceof Error ? err.message : String(err)}`);
        });
    }

    this.logger.log(`${scraperId}: recovered orphaned BD heal as attempt ${attemptId}`);

    return {
      scraperId,
      status: "pending_answer",
      attemptId,
      incidentId,
      step: null,
      completedSteps: [],
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      previewResult: progress.previewResult,
      diffSummary: progress.diff?.title ?? null,
      diff: progress.diff as HealDiff,
    };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async checkBudget(scraperId: string): Promise<void> {
    const todayCount = await this.repository.todaysHealCount(scraperId);
    if (todayCount >= this.budget.maxHealsPerScraperPerDay) {
      throw new BadRequestException(
        `Scraper ${scraperId} has reached the daily heal limit ` +
          `(${todayCount}/${this.budget.maxHealsPerScraperPerDay}).`,
      );
    }
  }

  /**
   * Resolve the heal prompt: use the body's prompt directly, or compose one
   * from an open incident's evidence, or fail.
   */
  private async resolvePrompt(
    scraperId: string,
    body: HealTriggerBody,
  ): Promise<{ prompt: string | null; findings: CheckResult[] }> {
    if (body.prompt) {
      return { prompt: body.prompt, findings: [] };
    }

    const incident = await this.repository.findOpenIncident(scraperId);
    if (!incident) {
      return { prompt: null, findings: [] };
    }

    const evidence = incident.evidence as Partial<IncidentEvidence>;
    const findings: CheckResult[] = Array.isArray(evidence.failedChecks)
      ? evidence.failedChecks
      : [];

    if (findings.length === 0) {
      return {
        prompt: `The scraper has an open ${incident.kind} incident. Inspect and fix.`,
        findings: [],
      };
    }

    const fields = findingsToFields(findings);
    const prompt = buildHealPrompt(fields);
    return { prompt: prompt || null, findings };
  }

  private async buildIncidentContext(scraperId: string): Promise<IncidentContext> {
    const raw = await this.repository.findOpenIncidentFull(scraperId);
    if (!raw) return null;

    const evidence = raw.evidence as Partial<IncidentEvidence>;
    return {
      id: raw.id,
      kind: raw.kind as IncidentEvidence["kind"],
      openedAt: raw.openedAt,
      failedChecks: Array.isArray(evidence.failedChecks) ? evidence.failedChecks : [],
      fieldNullRates: evidence.fieldNullRates ?? {},
      baselineNullRates: evidence.baselineNullRates ?? {},
      sampleBadRows: Array.isArray(evidence.sampleBadRows) ? evidence.sampleBadRows : [],
      rowCount: evidence.rowCount ?? 0,
      expectedRowCount: evidence.expectedRowCount ?? 0,
    };
  }

  /**
   * Ensure an incident exists for this heal attempt. Reuse an open one if
   * available, otherwise create a new one.
   */
  private async ensureIncident(
    scraperId: string,
    storeId: string | null,
    findings: CheckResult[],
  ): Promise<string> {
    const existing = await this.repository.findOpenIncident(scraperId);
    if (existing) {
      await this.repository.markIncidentHealing(existing.id);
      return existing.id;
    }

    const kind = (findings.length > 0 ? findings[0]?.check : undefined) ?? "error";
    const evidence: Partial<IncidentEvidence> = {
      kind: kind as IncidentEvidence["kind"],
      failedChecks: findings,
      sampleBadRows: [],
      sampleGoodRows: [],
      fieldNullRates: {},
      baselineNullRates: {},
      rowCount: 0,
      expectedRowCount: 0,
    };

    return this.repository.createIncident(
      scraperId,
      storeId,
      kind,
      evidence as Record<string, unknown>,
    );
  }
}
