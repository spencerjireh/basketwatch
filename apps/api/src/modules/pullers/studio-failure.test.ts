import { incidentEvidenceSchema, incidentKindSchema } from "@basketwatch/contract";
import { describe, expect, it } from "vitest";
import { STUDIO_FAILURE } from "./studio-failure.js";

describe("STUDIO_FAILURE", () => {
  it("heals exactly one kind of failure", () => {
    // A heal rewrites the extraction template. Everything else on this list is
    // a real failure that a template rewrite cannot repair, so healing it
    // spends a credit changing the one thing that was not wrong.
    const healable = Object.entries(STUDIO_FAILURE)
      .filter(([, policy]) => policy.autoHeal)
      .map(([kind]) => kind);
    expect(healable).toEqual(["broken"]);
  });

  it("gives every kind an incident kind the contract knows", () => {
    // The bug this guards: the puller used to write "studio_error", which was
    // absent from incidentKinds, so the read path silently relabelled every
    // Studio failure as a generic "error".
    for (const policy of Object.values(STUDIO_FAILURE)) {
      expect(incidentKindSchema.safeParse(policy.incidentKind).success).toBe(true);
    }
  });

  it("gives every kind a distinct incident kind", () => {
    const kinds = Object.values(STUDIO_FAILURE).map((p) => p.incidentKind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("writes a reason that reads as a sentence", () => {
    for (const policy of Object.values(STUDIO_FAILURE)) {
      const reason = policy.reason("collector returned no usable rows");
      expect(reason.length).toBeGreaterThan(20);
      expect(reason).not.toMatch(/^(error|failed)$/i);
    }
  });
});

describe("the evidence a Studio failure writes", () => {
  /** Mirrors handleStudioFailure's object, which is what has to parse. */
  const evidenceFor = (kind: keyof typeof STUDIO_FAILURE, message: string) => {
    const policy = STUDIO_FAILURE[kind];
    return {
      kind: policy.incidentKind,
      failedChecks: [{ check: policy.check, severity: "hard" as const, detail: message }],
      sampleBadRows: [{ title: "Milk", price: null }],
      sampleGoodRows: [],
      fieldNullRates: {},
      baselineNullRates: {},
      rowCount: 0,
      expectedRowCount: 0,
      reason: policy.reason(message),
      error: message,
      rawSample: [{ title: "Milk", price: null }],
      rawFieldNames: ["price", "title"],
      studioDetail: { killed: true, signal: "SIGTERM" },
    };
  };

  it("satisfies incidentEvidenceSchema, so the audit panel is not blanked", () => {
    // It used to fail this parse, and toEvidence's salvage path replaced the
    // whole bundle with zeroes: "0 of ~0 rows", no checks, no samples.
    for (const kind of Object.keys(STUDIO_FAILURE) as (keyof typeof STUDIO_FAILURE)[]) {
      const parsed = incidentEvidenceSchema.safeParse(evidenceFor(kind, "boom"));
      expect(parsed.success, `${kind} evidence should parse`).toBe(true);
      expect(parsed.success && parsed.data.failedChecks).toHaveLength(1);
      expect(parsed.success && parsed.data.sampleBadRows).toHaveLength(1);
    }
  });

  it("keeps the keys the heal prompt reads, even though the parse strips them", () => {
    // z.object strips unknown keys rather than rejecting them, so these
    // survive in the jsonb column. The orchestrator reads error and rawSample
    // off the raw row to compose its prompt; summarise reads reason.
    const raw = evidenceFor("broken", "fields moved");
    const parsed = incidentEvidenceSchema.parse(raw);
    expect("reason" in parsed).toBe(false);
    expect(raw.reason).toContain("none matched the output contract");
    expect(raw.error).toBe("fields moved");
    expect(raw.rawSample).toHaveLength(1);
  });
});
