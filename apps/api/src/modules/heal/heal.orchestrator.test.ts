import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealOrchestrator, type HealPollJob } from "./heal.orchestrator.js";

/**
 * The poll tick's decision table, with every dependency stubbed. What is
 * under test is the policy: what gets judged, what gets retried, what gets
 * failed, and that every side effect sits behind a won verdict claim.
 */

const goodPreviewRow = {
  name: "Eggs, dozen",
  price: "$4.29",
  url: "https://store.test/products/eggs-dozen",
};

const baseline = {
  fieldNullRates: { price: 0.02, name: 0 },
  expectedRowCount: 250,
  valueRanges: { price: [1, 20] as [number, number] },
};

function makeJob(overrides: Partial<HealPollJob> = {}): HealPollJob {
  return {
    scraperId: "c_test",
    storeId: "us-test",
    incidentId: "inc-1",
    attemptId: "att-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    errors: 0,
    ...overrides,
  };
}

function makeDeps() {
  const budget = {
    autoApproveEnabled: true,
    maxAttemptsPerIncident: 2,
    maxHealsPerScraperPerDay: 5,
  };
  const studio = {
    checkProgress: vi.fn(),
    approve: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
    proposeHeal: vi.fn().mockResolvedValue(undefined),
  };
  const repository = {
    getAttempt: vi.fn().mockResolvedValue({
      verdict: null,
      incidentId: "inc-1",
      scraperId: "c_test",
      storeId: "us-test",
    }),
    claimVerdict: vi.fn().mockResolvedValue(true),
    updateAttemptDiff: vi.fn().mockResolvedValue(undefined),
    claimCanary: vi.fn().mockResolvedValue(true),
    hasPendingCanary: vi.fn().mockResolvedValue(false),
    saveTemplate: vi.fn().mockResolvedValue("tpl-1"),
    resolveIncident: vi.fn().mockResolvedValue(undefined),
    reopenIncident: vi.fn().mockResolvedValue(undefined),
    markIncidentManual: vi.fn().mockResolvedValue(undefined),
    attemptCount: vi.fn().mockResolvedValue(1),
    findScraperWithStore: vi.fn().mockResolvedValue({
      scraper_id: "c_test",
      scraper_name: "test",
      target_site: "https://store.test",
      store_id: "us-test",
      store_name: "Test Store",
      store_endpoint: null,
    }),
    findOpenIncident: vi.fn().mockResolvedValue(null),
    todaysHealCount: vi.fn().mockResolvedValue(0),
    markIncidentHealing: vi.fn().mockResolvedValue(undefined),
    recordAttempt: vi.fn().mockResolvedValue("att-2"),
    createIncident: vi.fn().mockResolvedValue("inc-1"),
    getLatestTemplate: vi.fn().mockResolvedValue(null),
    findOpenIncidentFull: vi.fn().mockResolvedValue(null),
  };
  const validatorRepository = {
    loadBaseline: vi.fn().mockResolvedValue(baseline),
  };
  const boss = { send: vi.fn().mockResolvedValue("job-id") };

  const orchestrator = new HealOrchestrator(
    budget as never,
    studio as never,
    repository as never,
    validatorRepository as never,
    boss as never,
  );
  return { orchestrator, budget, studio, repository, validatorRepository, boss };
}

function pendingAnswer(previewResult: unknown[] | null) {
  return {
    id: "bd-1",
    status: "pending_answer",
    step: "user_approval",
    completedSteps: [],
    diff: { template_a: {}, template_b: { steps: [] }, title: "refactor" },
    previewResult,
    success: null,
  };
}

describe("pollTick", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("does nothing when the kill switch is off", async () => {
    deps.budget.autoApproveEnabled = false;
    await deps.orchestrator.pollTick(makeJob());
    expect(deps.studio.checkProgress).not.toHaveBeenCalled();
  });

  it("drops a tick whose attempt was settled elsewhere", async () => {
    deps.repository.getAttempt.mockResolvedValue({
      verdict: "approved",
      incidentId: "inc-1",
      scraperId: "c_test",
      storeId: "us-test",
    });
    await deps.orchestrator.pollTick(makeJob());
    expect(deps.studio.checkProgress).not.toHaveBeenCalled();
  });

  it("approves a passing preview, saves the template, and fires the canary", async () => {
    deps.studio.checkProgress.mockResolvedValue(pendingAnswer([goodPreviewRow]));
    await deps.orchestrator.pollTick(makeJob());

    expect(deps.studio.approve).toHaveBeenCalledWith("c_test");
    expect(deps.repository.claimVerdict).toHaveBeenCalledWith(
      "att-1",
      "approved",
      expect.any(String),
    );
    expect(deps.repository.saveTemplate).toHaveBeenCalled();
    // The incident is NOT resolved on approval: the canary decides.
    expect(deps.repository.resolveIncident).not.toHaveBeenCalled();
    expect(deps.boss.send).toHaveBeenCalledWith(
      "scrape-run",
      { storeId: "us-test", trigger: "canary", healAttemptId: "att-1" },
      expect.objectContaining({ singletonKey: "us-test" }),
    );
  });

  it("runs no side effects when the approve claim is lost", async () => {
    deps.studio.checkProgress.mockResolvedValue(pendingAnswer([goodPreviewRow]));
    deps.repository.claimVerdict.mockResolvedValue(false);
    await deps.orchestrator.pollTick(makeJob());

    expect(deps.repository.saveTemplate).not.toHaveBeenCalled();
    expect(deps.boss.send).not.toHaveBeenCalled();
  });

  it("rejects a failing preview and re-proposes under the cap", async () => {
    deps.studio.checkProgress.mockResolvedValue(pendingAnswer([]));
    const trigger = vi
      .spyOn(deps.orchestrator, "trigger")
      .mockResolvedValue({ status: "running" } as never);

    await deps.orchestrator.pollTick(makeJob());

    expect(deps.studio.reject).toHaveBeenCalledWith("c_test");
    expect(deps.repository.claimVerdict).toHaveBeenCalledWith("att-1", "rejected", null);
    expect(trigger).toHaveBeenCalledWith("c_test", {
      prompt: expect.stringContaining("rejected"),
    });
    expect(deps.repository.markIncidentManual).not.toHaveBeenCalled();
  });

  it("holds for a person at the cap instead of re-proposing", async () => {
    deps.studio.checkProgress.mockResolvedValue(pendingAnswer([]));
    deps.repository.attemptCount.mockResolvedValue(2);
    const trigger = vi.spyOn(deps.orchestrator, "trigger");

    await deps.orchestrator.pollTick(makeJob());

    expect(deps.repository.markIncidentManual).toHaveBeenCalledWith("inc-1");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("holds for a person when the re-proposal fails to start", async () => {
    deps.studio.checkProgress.mockResolvedValue(pendingAnswer([]));
    vi.spyOn(deps.orchestrator, "trigger").mockResolvedValue({ status: "error" } as never);

    await deps.orchestrator.pollTick(makeJob());

    expect(deps.repository.markIncidentManual).toHaveBeenCalledWith("inc-1");
  });

  it("leaves a proposal at the gate when no baseline exists", async () => {
    deps.studio.checkProgress.mockResolvedValue(pendingAnswer([goodPreviewRow]));
    deps.validatorRepository.loadBaseline.mockResolvedValue(null);

    await deps.orchestrator.pollTick(makeJob());

    expect(deps.studio.approve).not.toHaveBeenCalled();
    expect(deps.studio.reject).not.toHaveBeenCalled();
    expect(deps.repository.claimVerdict).not.toHaveBeenCalled();
  });

  it("tolerates one transient BD error and requeues", async () => {
    deps.studio.checkProgress.mockResolvedValue({ status: "error" });
    await deps.orchestrator.pollTick(makeJob({ errors: 0 }));

    expect(deps.repository.claimVerdict).not.toHaveBeenCalled();
    expect(deps.boss.send).toHaveBeenCalledWith(
      "heal-poll",
      expect.objectContaining({ errors: 1 }),
      expect.anything(),
    );
  });

  it("fails the attempt on the second consecutive BD error", async () => {
    deps.studio.checkProgress.mockResolvedValue({ status: "error" });
    deps.repository.attemptCount.mockResolvedValue(2);
    await deps.orchestrator.pollTick(makeJob({ errors: 1 }));

    expect(deps.repository.claimVerdict).toHaveBeenCalledWith("att-1", "failed", null);
    expect(deps.repository.markIncidentManual).toHaveBeenCalledWith("inc-1");
  });

  it("requeues a running heal before its deadline, resetting the error streak", async () => {
    deps.studio.checkProgress.mockResolvedValue({ status: "running" });
    await deps.orchestrator.pollTick(makeJob({ errors: 1 }));

    expect(deps.boss.send).toHaveBeenCalledWith(
      "heal-poll",
      expect.objectContaining({ errors: 0 }),
      expect.anything(),
    );
  });

  it("fails a heal still running past its deadline", async () => {
    deps.studio.checkProgress.mockResolvedValue({ status: "running" });
    deps.repository.attemptCount.mockResolvedValue(2);
    await deps.orchestrator.pollTick(
      makeJob({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    expect(deps.repository.claimVerdict).toHaveBeenCalledWith("att-1", "failed", null);
  });
});

describe("handleCanaryOutcome", () => {
  it("resolves the incident on a passing canary and records it", async () => {
    const deps = makeDeps();
    await deps.orchestrator.handleCanaryOutcome("att-1", {
      ranAt: new Date().toISOString(),
      rows: 42,
      nullRatePct: 3,
      status: "ok",
    });
    expect(deps.repository.claimCanary).toHaveBeenCalled();
    expect(deps.repository.resolveIncident).toHaveBeenCalledWith("inc-1");
  });

  it("resolves on suspect too -- soft findings are prices moving, not breakage", async () => {
    const deps = makeDeps();
    await deps.orchestrator.handleCanaryOutcome("att-1", {
      ranAt: new Date().toISOString(),
      rows: 40,
      nullRatePct: 5,
      status: "suspect",
    });
    expect(deps.repository.resolveIncident).toHaveBeenCalledWith("inc-1");
  });

  it("treats an ok verdict with zero rows as a failed verification", async () => {
    const deps = makeDeps();
    deps.repository.attemptCount.mockResolvedValue(2);
    await deps.orchestrator.handleCanaryOutcome("att-1", {
      ranAt: new Date().toISOString(),
      rows: 0,
      nullRatePct: 0,
      status: "ok",
    });
    expect(deps.repository.resolveIncident).not.toHaveBeenCalled();
    expect(deps.repository.markIncidentManual).toHaveBeenCalledWith("inc-1");
  });

  it("drops a duplicate canary outcome without touching the incident", async () => {
    const deps = makeDeps();
    deps.repository.claimCanary.mockResolvedValue(false);
    await deps.orchestrator.handleCanaryOutcome("att-1", {
      ranAt: new Date().toISOString(),
      rows: 0,
      nullRatePct: 100,
      status: "broken",
    });
    expect(deps.repository.resolveIncident).not.toHaveBeenCalled();
    expect(deps.repository.markIncidentManual).not.toHaveBeenCalled();
  });

  it("counts a broken canary toward the cap and re-proposes under it", async () => {
    const deps = makeDeps();
    deps.repository.attemptCount.mockResolvedValue(1);
    const trigger = vi
      .spyOn(deps.orchestrator, "trigger")
      .mockResolvedValue({ status: "running" } as never);

    await deps.orchestrator.handleCanaryOutcome("att-1", {
      ranAt: new Date().toISOString(),
      rows: 0,
      nullRatePct: 100,
      status: "broken",
    });
    expect(trigger).toHaveBeenCalled();
    expect(deps.repository.resolveIncident).not.toHaveBeenCalled();
  });
});
