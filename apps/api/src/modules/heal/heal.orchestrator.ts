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
import { z } from "zod";
import { BossService } from "../../jobs/boss.provider.js";
import { QUEUES } from "../../jobs/queues.js";
import { validateSample } from "../validator/checks.js";
import { ValidatorRepository } from "../validator/validator.repository.js";
import { HealBudget } from "./heal.budget.js";
import { HealRepository } from "./heal.repository.js";
import { normalizePreviewRows } from "./preview.js";
import { buildHealPrompt, diagnoseRawOutput, findingsToFields } from "./prompt.js";
import { StudioClient, StudioHealError, type HealProgressResult } from "./studio.client.js";

/** One link in the self-rescheduling poll chain that watches a BD heal. */
export interface HealPollJob {
  scraperId: string;
  storeId: string | null;
  incidentId: string;
  attemptId: string;
  /** ISO timestamp after which a still-running heal is failed. */
  expiresAt: string;
  /** Consecutive checkProgress errors -- one transient BD 5xx must not burn an attempt. */
  errors: number;
}

/** How long a proposal may keep running before the poll loop gives up on it. */
const POLL_DEADLINE_MS = 12 * 60 * 1000;
const POLL_INTERVAL_S = 30;

/**
 * The same four fields the validator's storedProductSchema demands, applied
 * to normalised preview rows: this is the question a heal exists to answer.
 */
const previewRowSchema = z.object({
  product_key: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
  url: z.string().min(1),
});
const parsePreviewRow = (row: unknown) => previewRowSchema.safeParse(row).success;

@Injectable()
export class HealOrchestrator {
  private readonly logger = new Logger(HealOrchestrator.name);

  constructor(
    private readonly budget: HealBudget,
    private readonly studio: StudioClient,
    private readonly repository: HealRepository,
    private readonly validatorRepository: ValidatorRepository,
    private readonly boss: BossService,
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

    // If BD says error/done while we still have a pending attempt, close it --
    // but only if the poll worker has not settled it already. The claim is the
    // arbiter; the loser of the race must not also reopen the incident.
    if (progress.status === "error" || progress.status === "done") {
      const claimed = await this.repository.claimVerdict(pending.attemptId, "failed", null);
      if (claimed) await this.repository.reopenIncident(pending.incidentId);
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
      const claimed = await this.repository.claimVerdict(attemptId, "failed", null);
      if (claimed) await this.repository.reopenIncident(incidentId);
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

    // Trigger succeeded -- BD is processing asynchronously. The dashboard may
    // watch via GET /status, but the poll chain is what settles the attempt:
    // with auto-approve on, nobody has to be looking for the loop to close.
    if (this.budget.autoApproveEnabled) {
      await this.boss.send(
        QUEUES.healPoll,
        {
          scraperId,
          storeId: scraper.store_id,
          incidentId,
          attemptId,
          expiresAt: new Date(Date.now() + POLL_DEADLINE_MS).toISOString(),
          errors: 0,
        } satisfies HealPollJob,
        { startAfter: 20, retryLimit: 0 },
      );
    }

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

    const claimed = await this.repository.claimVerdict(pending.attemptId, "approved", storedDiff);
    if (!claimed) {
      // Another writer (the poll worker, or a concurrent request) settled this
      // attempt first. BD has been told to approve either way; report what the
      // caller asked for and change nothing else.
      this.logger.warn(`${scraperId}: approve lost the verdict race for ${pending.attemptId}`);
      return { scraperId, attemptId: pending.attemptId, verdict: "approved" };
    }

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

    // An approval is a claim, not a proof. When the scraper has a store, the
    // incident stays 'healing' until one canary pull validates against the
    // baseline; only a storeless scraper resolves on approval alone.
    const scraper = await this.repository.findScraperWithStore(scraperId);
    if (scraper?.store_id) {
      await this.enqueueCanary(scraper.store_id, pending.attemptId);
    } else {
      await this.repository.resolveIncident(pending.incidentId);
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

    const claimed = await this.repository.claimVerdict(pending.attemptId, "rejected", null);
    if (claimed) await this.repository.reopenIncident(pending.incidentId);

    this.logger.log(`${scraperId}: heal rejected/cancelled (attempt ${pending.attemptId})`);
    return {
      scraperId,
      attemptId: pending.attemptId,
      verdict: "rejected",
    };
  }

  // -----------------------------------------------------------------------
  // The machine judge: one tick of the poll chain
  // -----------------------------------------------------------------------

  /**
   * Called by the heal-poll worker for each link in the chain. Uniform
   * policy: pending_answer is judged; error twice in a row, done-without-a-
   * gate, or running past the deadline all fail the attempt and go through
   * the cap. Every settlement is a claimVerdict -- if the dashboard settled
   * the attempt first, this tick does nothing.
   */
  async pollTick(job: HealPollJob): Promise<void> {
    if (!this.budget.autoApproveEnabled) {
      this.logger.log(`${job.scraperId}: auto-approve is off; leaving the heal to the dashboard`);
      return;
    }

    const attempt = await this.repository.getAttempt(job.attemptId);
    if (!attempt || attempt.verdict !== null) return;

    const progress = await this.studio.checkProgress(job.scraperId);

    if (progress.status === "pending_answer") {
      if (progress.diff) {
        await this.repository
          .updateAttemptDiff(job.attemptId, JSON.stringify(progress.diff))
          .catch(() => undefined);
      }
      await this.judge(job, progress);
      return;
    }

    if (progress.status === "error") {
      // checkProgress reports a synthetic error on any non-200, so one BD
      // hiccup must not burn a proposal. Two in a row is a real failure.
      const errors = job.errors + 1;
      if (errors < 2) {
        await this.requeuePoll(job, errors);
        return;
      }
      await this.failAttempt(job, "Bright Data reported the heal session failed");
      return;
    }

    if (progress.status === "done") {
      await this.failAttempt(job, "heal finished on Bright Data without an approval gate");
      return;
    }

    // Still running (or a status we do not know). The deadline only applies
    // here: a stale job that finds pending_answer above is judged, not expired.
    if (Date.now() > new Date(job.expiresAt).getTime()) {
      await this.failAttempt(job, "heal exceeded its deadline on Bright Data");
      return;
    }
    await this.requeuePoll(job, 0);
  }

  /** Judge a proposal at the approval gate: preview sample vs store baseline. */
  private async judge(job: HealPollJob, progress: HealProgressResult): Promise<void> {
    const baseline = job.storeId
      ? await this.validatorRepository.loadBaseline(job.storeId)
      : null;
    if (!baseline || baseline.expectedRowCount <= 0) {
      // Nothing to judge against. Leave the proposal at the gate for a person;
      // the dashboard shows it exactly as before this loop existed.
      this.logger.warn(
        `${job.scraperId}: no baseline for ${job.storeId ?? "(no store)"}; ` +
          "leaving the proposal for human review",
      );
      return;
    }

    const rows = normalizePreviewRows(progress.previewResult ?? []);
    const verdict = validateSample(rows, parsePreviewRow, baseline);
    const summary = verdict.findings.map((f) => f.detail).join("; ").slice(0, 300);

    if (verdict.status !== "broken") {
      await this.studio.approve(job.scraperId);
      const diffJson = progress.diff ? JSON.stringify(progress.diff) : null;
      const claimed = await this.repository.claimVerdict(job.attemptId, "approved", diffJson);
      if (!claimed) {
        this.logger.warn(
          `${job.scraperId}: auto-approve told BD yes but lost the verdict race ` +
            `for ${job.attemptId}; incident left as-is`,
        );
        return;
      }

      if (progress.diff?.template_b) {
        await this.repository
          .saveTemplate(job.scraperId, progress.diff.template_b, "heal_approved", job.attemptId)
          .catch(() => undefined);
      }

      this.logger.log(
        `${job.scraperId}: preview passed (${rows.length} rows, ${verdict.status}); ` +
          "approved -- canary pull will decide the incident",
      );
      if (job.storeId) {
        await this.enqueueCanary(job.storeId, job.attemptId);
      } else {
        await this.repository.resolveIncident(job.incidentId);
      }
      return;
    }

    try {
      await this.studio.reject(job.scraperId);
    } catch (err) {
      this.logger.warn(
        `${job.scraperId}: BD reject failed -- ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const claimed = await this.repository.claimVerdict(job.attemptId, "rejected", null);
    if (!claimed) return;
    this.logger.log(`${job.scraperId}: preview failed validation (${summary}); rejected`);
    await this.reproposeOrHold(
      job.scraperId,
      job.incidentId,
      `the previous machine proposal was rejected because its preview sample failed validation: ${summary}`,
    );
  }

  /** A terminal failure on the BD side: claim it, then re-propose or hold. */
  private async failAttempt(job: HealPollJob, why: string): Promise<void> {
    const claimed = await this.repository.claimVerdict(job.attemptId, "failed", null);
    if (!claimed) return;
    this.logger.warn(`${job.scraperId}: heal attempt ${job.attemptId} failed -- ${why}`);
    await this.reproposeOrHold(job.scraperId, job.incidentId, why);
  }

  /**
   * The cap decision. Under the per-incident cap, propose again with feedback
   * about why the last proposal died; at the cap (or if the re-proposal
   * itself cannot start), hold the incident for a person. The incident stays
   * 'healing' between machine attempts -- 'manual' is the terminal hold.
   */
  private async reproposeOrHold(
    scraperId: string,
    incidentId: string,
    why: string,
  ): Promise<void> {
    const attempts = await this.repository.attemptCount(incidentId);
    if (attempts >= this.budget.maxAttemptsPerIncident) {
      await this.repository.markIncidentManual(incidentId);
      this.logger.warn(
        `${scraperId}: ${attempts} proposals spent on incident ${incidentId}; held for a person`,
      );
      return;
    }

    try {
      const { prompt } = await this.resolvePrompt(scraperId, {});
      const feedback = `${prompt ?? "The scraper has an open incident. Inspect and fix."}\n\n` +
        `Note: ${why}. Propose a different fix.`;
      const result = await this.trigger(scraperId, { prompt: feedback.slice(0, 1500) });
      if (result.status === "error") {
        // trigger() reports proposeHeal failures in-band rather than throwing.
        await this.repository.markIncidentManual(incidentId);
        this.logger.warn(`${scraperId}: re-proposal failed to start; incident held for a person`);
        return;
      }
      this.logger.log(`${scraperId}: re-proposed (attempt ${attempts + 1}) after: ${why}`);
    } catch (err) {
      await this.repository.markIncidentManual(incidentId);
      this.logger.warn(
        `${scraperId}: re-proposal threw (${err instanceof Error ? err.message : String(err)}); ` +
          "incident held for a person",
      );
    }
  }

  /**
   * The verification pull's verdict, reported by the validate-run handler.
   * ok or suspect with rows applied resolves the incident -- suspect is soft
   * findings only, and prices legitimately move; nothing else in the system
   * would ever close the incident on a later good run. Broken counts toward
   * the same per-incident cap as a failed preview.
   */
  async handleCanaryOutcome(
    healAttemptId: string,
    canary: { ranAt: string; rows: number; nullRatePct: number; status: string },
  ): Promise<void> {
    const claimed = await this.repository.claimCanary(healAttemptId, JSON.stringify(canary));
    if (!claimed) {
      // A duplicate verification already reported. Only the first may drive
      // the cap, or two copies of one failure spend both proposals.
      this.logger.warn(`attempt ${healAttemptId}: duplicate canary outcome dropped`);
      return;
    }

    const attempt = await this.repository.getAttempt(healAttemptId);
    if (!attempt) return;

    const healthy = canary.status !== "broken" && canary.rows > 0;
    if (healthy) {
      await this.repository.resolveIncident(attempt.incidentId);
      this.logger.log(
        `${attempt.scraperId}: canary passed (${canary.rows} rows, ${canary.status}); ` +
          `incident ${attempt.incidentId} resolved`,
      );
      return;
    }

    this.logger.warn(
      `${attempt.scraperId}: canary failed (${canary.rows} rows, ${canary.status})`,
    );
    await this.reproposeOrHold(
      attempt.scraperId,
      attempt.incidentId,
      `the approved template failed its verification pull (${canary.rows} rows, status ${canary.status})`,
    );
  }

  /** Re-fire lost verification pulls; called by the boot sweep. */
  async sweepApprovedAwaitingCanary(): Promise<number> {
    const stranded = await this.repository.listApprovedAwaitingCanary();
    let fired = 0;
    for (const { attemptId, storeId } of stranded) {
      // pg-boss keeps jobs across restarts: a canary that is merely queued or
      // mid-run is not lost, and re-firing it would double the pull's spend.
      if (await this.repository.hasPendingCanary(attemptId)) continue;
      await this.enqueueCanary(storeId, attemptId);
      this.logger.warn(`${storeId}: re-fired lost canary for approved attempt ${attemptId}`);
      fired += 1;
    }
    return fired;
  }

  /** The verification pull behind every approval. */
  private async enqueueCanary(storeId: string, healAttemptId: string): Promise<void> {
    await this.boss.send(
      QUEUES.scrapeRun,
      { storeId, trigger: "canary", healAttemptId },
      { singletonKey: storeId, retryLimit: 0, expireInSeconds: 1800 },
    );
    this.logger.log(`${storeId}: canary pull enqueued for attempt ${healAttemptId}`);
  }

  /** The next link in the chain. */
  private async requeuePoll(job: HealPollJob, errors: number): Promise<void> {
    await this.boss.send(
      QUEUES.healPoll,
      { ...job, errors } satisfies HealPollJob,
      { startAfter: POLL_INTERVAL_S, retryLimit: 0 },
    );
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

    const evidence = incident.evidence as Partial<IncidentEvidence> & {
      rawSample?: unknown[];
      error?: string;
    };
    const findings: CheckResult[] = Array.isArray(evidence.failedChecks)
      ? evidence.failedChecks
      : [];

    const checkFields = findingsToFields(findings);

    const rawSample = Array.isArray(evidence.rawSample) ? evidence.rawSample : [];
    const rawFields = diagnoseRawOutput(rawSample);

    const seen = new Set(checkFields.map((f) => f.name));
    const merged = [...checkFields];
    for (const rf of rawFields) {
      if (!seen.has(rf.name)) {
        merged.push(rf);
        seen.add(rf.name);
      }
    }

    if (merged.length === 0 && evidence.error) {
      merged.push({
        name: "scraper output",
        symptom: evidence.error.slice(0, 150),
        selectorHint: "Inspect the extraction logic and fix",
      });
    }

    if (merged.length === 0) {
      return {
        prompt: `The scraper has an open ${incident.kind} incident. Inspect and fix.`,
        findings: [],
      };
    }

    const prompt = buildHealPrompt(merged);
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
