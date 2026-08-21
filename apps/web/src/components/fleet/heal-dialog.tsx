"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveHeal,
  fetchHealStatus,
  fetchPreviewPrompt,
  rejectHeal,
  triggerHeal,
} from "@/app/behind/actions";

type TemplateStep = Record<string, unknown>;

/** Pull all code blocks from a BD template step (main code + parser). */
function extractCode(step: TemplateStep): string | null {
  const parts: string[] = [];
  if (typeof step.code === "string") parts.push(step.code);
  const parse =
    typeof step.parse_code === "string"
      ? step.parse_code
      : typeof (step.parser as Record<string, unknown>)?.parser === "string"
        ? (step.parser as Record<string, unknown>).parser as string
        : typeof step.parse === "string"
          ? step.parse
          : null;
  if (parse) parts.push(`--- parser ---\n${parse}`);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** BD returns templates as either an array of steps or an object with a .steps array. */
function extractSteps(raw: TemplateStep[] | Record<string, unknown>): TemplateStep[] {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.steps)) return raw.steps as TemplateStep[];
  return [];
}

interface DiffData {
  title: string;
  template_a: TemplateStep[] | Record<string, unknown>;
  template_b: TemplateStep[] | Record<string, unknown>;
}

interface IncidentCtx {
  id: string;
  kind: string;
  openedAt: string;
  failedChecks: { check: string; severity: string; detail: string }[];
  fieldNullRates: Record<string, number>;
  baselineNullRates: Record<string, number>;
  sampleBadRows: unknown[];
  rowCount: number;
  expectedRowCount: number;
}

type HealState =
  | { step: "loading" }
  | { step: "idle"; defaultPrompt: string | null; incident: IncidentCtx | null; currentTemplate: TemplateStep[] | null }
  | {
      step: "triggering";
      startedAt: number;
      bdStep: string | null;
      completedSteps: string[];
    }
  | {
      step: "pending";
      prompt: string;
      diff: DiffData | null;
      previewResult: unknown[] | null;
      startedAt: number;
      finishedAt: number;
    }
  | { step: "deciding" }
  | { step: "done"; verdict: string; startedAt: number; finishedAt: number }
  | { step: "error"; message: string };

export function HealDialog({
  scraperId,
  storeName,
  open,
  onClose,
}: {
  scraperId: string;
  storeName: string;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<HealState>({ step: "loading" });
  const [prompt, setPrompt] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      stopPolling();
      return;
    }
    setState({ step: "loading" });
    setPrompt("");

    (async () => {
      const statusRes = await fetchHealStatus(scraperId);
      if (
        statusRes.ok &&
        statusRes.data.status !== "idle" &&
        statusRes.data.attemptId
      ) {
        const startedAt = statusRes.data.startedAt
          ? new Date(statusRes.data.startedAt as string).getTime()
          : Date.now();

        if (statusRes.data.status === "pending_answer" && statusRes.data.diff) {
          setState({
            step: "pending",
            prompt: "",
            diff: statusRes.data.diff as DiffData,
            previewResult: (statusRes.data.previewResult as unknown[]) ?? null,
            startedAt,
            finishedAt: Date.now(),
          });
          return;
        }

        setState({
          step: "triggering",
          startedAt,
          bdStep: (statusRes.data.step as string) ?? null,
          completedSteps: (statusRes.data.completedSteps as string[]) ?? [],
        });
        startPolling(startedAt);
        return;
      }

      const promptRes = await fetchPreviewPrompt(scraperId);
      const auto =
        promptRes.ok && typeof promptRes.data.prompt === "string"
          ? promptRes.data.prompt
          : null;
      const incident =
        promptRes.ok && promptRes.data.incident
          ? (promptRes.data.incident as IncidentCtx)
          : null;
      const tpl =
        promptRes.ok && Array.isArray(promptRes.data.currentTemplate)
          ? (promptRes.data.currentTemplate as TemplateStep[])
          : null;
      setState({ step: "idle", defaultPrompt: auto, incident, currentTemplate: tpl });
      if (auto) setPrompt(auto);
    })();

    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scraperId]);

  const startPolling = useCallback(
    (startedAt: number) => {
      stopPolling();
      const tick = async () => {
        const res = await fetchHealStatus(scraperId);
        if (!res.ok) {
          pollRef.current = setTimeout(tick, 4000);
          return;
        }

        if (res.data.status === "pending_answer") {
          pollRef.current = null;
          setState({
            step: "pending",
            prompt: "",
            diff: (res.data.diff as DiffData) ?? null,
            previewResult: (res.data.previewResult as unknown[]) ?? null,
            startedAt,
            finishedAt: Date.now(),
          });
        } else if (res.data.status === "error" || res.data.status === "idle") {
          pollRef.current = null;
          setState({ step: "error", message: "Heal failed on Bright Data side." });
        } else {
          setState((prev) => {
            if (prev.step !== "triggering") return prev;
            return {
              ...prev,
              bdStep: (res.data.step as string) ?? prev.bdStep,
              completedSteps:
                (res.data.completedSteps as string[]) ?? prev.completedSteps,
            };
          });
          pollRef.current = setTimeout(tick, 4000);
        }
      };
      pollRef.current = setTimeout(tick, 2000);
    },
    [scraperId, stopPolling],
  );

  const handleClose = useCallback(() => {
    stopPolling();
    setState({ step: "loading" });
    setPrompt("");
    onClose();
  }, [onClose, stopPolling]);

  const handleTrigger = useCallback(async () => {
    const startedAt = Date.now();
    setState({
      step: "triggering",
      startedAt,
      bdStep: null,
      completedSteps: [],
    });

    const result = await triggerHeal(scraperId, prompt || undefined);

    if (!result.ok) {
      setState({ step: "error", message: JSON.stringify(result.data) });
      return;
    }

    const status = result.data.status as string;
    if (status === "error") {
      setState({ step: "error", message: "Heal trigger failed on Bright Data side." });
      return;
    }

    // Trigger accepted (status === "running") -- poll for live progress
    startPolling(startedAt);
  }, [scraperId, prompt, startPolling]);

  const handleCancel = useCallback(async () => {
    stopPolling();
    setState({ step: "deciding" });
    const result = await rejectHeal(scraperId);
    if (result.ok) {
      setState({
        step: "done",
        verdict: "cancelled",
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
    } else {
      setState({ step: "error", message: JSON.stringify(result.data) });
    }
  }, [scraperId, stopPolling]);

  const handleApprove = useCallback(async () => {
    const startedAt =
      state.step === "pending" ? state.startedAt : Date.now();
    setState({ step: "deciding" });
    const result = await approveHeal(scraperId);
    if (result.ok) {
      setState({
        step: "done",
        verdict: "approved",
        startedAt,
        finishedAt: Date.now(),
      });
    } else {
      setState({ step: "error", message: JSON.stringify(result.data) });
    }
  }, [scraperId, state]);

  const handleReject = useCallback(async () => {
    const startedAt =
      state.step === "pending" ? state.startedAt : Date.now();
    setState({ step: "deciding" });
    const result = await rejectHeal(scraperId);
    if (result.ok) {
      setState({
        step: "done",
        verdict: "rejected",
        startedAt,
        finishedAt: Date.now(),
      });
    } else {
      setState({ step: "error", message: JSON.stringify(result.data) });
    }
  }, [scraperId, state]);

  return (
    <dialog
      ref={ref}
      onClose={handleClose}
      onClick={(e) => {
        if (e.target === ref.current) handleClose();
      }}
      className="m-auto w-[min(92vw,680px)] rounded-sm border border-line bg-paper p-0 text-ink backdrop:bg-ink/40"
      aria-label="Heal scraper"
    >
      <div className="max-h-[85vh] overflow-y-auto px-5 py-5 font-mono text-[12px] leading-relaxed">
        <header className="text-center">
          <h2 className="font-display text-[19px]">Heal scraper</h2>
          <p className="mt-0.5 text-mute">{storeName}</p>
        </header>

        <div className="rule my-3" />

        {state.step === "loading" && <LoadingSpinner label="Loading..." />}

        {state.step === "idle" && (
          <IdleView
            incident={state.incident}
            currentTemplate={state.currentTemplate}
            defaultPrompt={state.defaultPrompt}
            prompt={prompt}
            onPromptChange={setPrompt}
            onTrigger={handleTrigger}
          />
        )}

        {state.step === "triggering" && (
          <TriggeringView
            startedAt={state.startedAt}
            bdStep={state.bdStep}
            completedSteps={state.completedSteps}
            onCancel={handleCancel}
          />
        )}

        {state.step === "pending" && (
          <PendingView
            prompt={state.prompt}
            diff={state.diff}
            previewResult={state.previewResult}
            startedAt={state.startedAt}
            finishedAt={state.finishedAt}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}

        {state.step === "deciding" && <LoadingSpinner label="Processing..." />}

        {state.step === "done" && (
          <DoneView
            verdict={state.verdict}
            startedAt={state.startedAt}
            finishedAt={state.finishedAt}
            onClose={handleClose}
          />
        )}

        {state.step === "error" && (
          <ErrorView
            message={state.message}
            onRetry={() => {
              setState({ step: "loading" });
              fetchPreviewPrompt(scraperId).then((res) => {
                const auto =
                  res.ok && typeof res.data.prompt === "string"
                    ? res.data.prompt
                    : null;
                const incident =
                  res.ok && res.data.incident
                    ? (res.data.incident as IncidentCtx)
                    : null;
                const tpl =
                  res.ok && Array.isArray(res.data.currentTemplate)
                    ? (res.data.currentTemplate as TemplateStep[])
                    : null;
                setState({ step: "idle", defaultPrompt: auto, incident, currentTemplate: tpl });
                if (auto) setPrompt(auto);
              });
            }}
          />
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <span className="inline-block size-4 animate-spin rounded-full border-2 border-heal border-t-transparent" />
      <p className="text-[11px] text-mute">{label}</p>
    </div>
  );
}

function IdleView({
  incident,
  currentTemplate,
  defaultPrompt,
  prompt,
  onPromptChange,
  onTrigger,
}: {
  incident: IncidentCtx | null;
  currentTemplate: TemplateStep[] | null;
  defaultPrompt: string | null;
  prompt: string;
  onPromptChange: (v: string) => void;
  onTrigger: () => void;
}) {
  return (
    <>
      {incident && <EvidenceSection incident={incident} />}

      {currentTemplate && currentTemplate.length > 0 && (
        <CurrentCodeSection steps={currentTemplate} />
      )}

      <p className="caps">Heal prompt</p>
      {defaultPrompt ? (
        <p className="mt-1 text-[10px] text-mute">
          Auto-generated from the incident evidence. Edit if needed.
        </p>
      ) : (
        <p className="mt-1 text-[10px] text-mute">
          No incident evidence found. Enter a prompt describing what to fix.
        </p>
      )}
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        rows={4}
        className="mt-2 w-full resize-none rounded-sm border border-line bg-wash px-3 py-2 text-[11px] text-ink placeholder:text-mute/60 focus:border-heal focus:outline-none"
        placeholder="e.g. Fix size_value and size_uom extraction..."
      />
      <button
        type="button"
        onClick={onTrigger}
        disabled={!prompt.trim()}
        className="mt-3 w-full rounded-sm bg-heal py-1.5 text-[11px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-heal/80 disabled:opacity-40"
      >
        Trigger heal
      </button>
      <p className="mt-2 text-center text-[10px] text-mute">
        Sends a heal request to Bright Data (1-5 min). The scraper is not
        modified until you approve.
      </p>
    </>
  );
}

function EvidenceSection({ incident }: { incident: IncidentCtx }) {
  const [expanded, setExpanded] = useState(false);
  const nullFields = Object.keys(incident.fieldNullRates).filter(
    (f) =>
      incident.fieldNullRates[f]! > (incident.baselineNullRates[f] ?? 0) + 5,
  );

  return (
    <div className="mb-4">
      <p className="caps text-broken">Why heal?</p>
      <div className="mt-2 rounded-sm border border-broken/20 bg-broken/5 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium text-broken">
            {incident.kind} incident
          </span>
          <span className="text-[10px] text-mute">
            opened {formatTime(incident.openedAt)}
          </span>
        </div>

        {incident.failedChecks.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-mute">Failed checks</p>
            <ul className="mt-1 space-y-0.5">
              {incident.failedChecks.map((c, i) => (
                <li key={i} className="text-[10.5px]">
                  <span
                    className={`inline-block w-10 text-[9px] uppercase ${c.severity === "hard" ? "text-broken" : "text-heal"}`}
                  >
                    {c.severity}
                  </span>
                  <span className="text-mute">{c.check}:</span> {c.detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        {nullFields.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-mute">Elevated null rates</p>
            <table className="mt-1 w-full text-[10px]">
              <thead>
                <tr className="text-left text-mute">
                  <th className="pb-0.5 font-normal">Field</th>
                  <th className="pb-0.5 font-normal text-right">Actual</th>
                  <th className="pb-0.5 font-normal text-right">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {nullFields.slice(0, 8).map((f) => (
                  <tr key={f}>
                    <td className="py-px">{f}</td>
                    <td className="py-px text-right text-broken">
                      {(incident.fieldNullRates[f]! * 100).toFixed(0)}%
                    </td>
                    <td className="py-px text-right text-mute">
                      {((incident.baselineNullRates[f] ?? 0) * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {incident.sampleBadRows.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-mute underline decoration-1 underline-offset-2 hover:text-ink"
            >
              {expanded ? "Hide" : "Show"} sample bad rows (
              {incident.sampleBadRows.length})
            </button>
            {expanded && (
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[10px]">
                {JSON.stringify(incident.sampleBadRows.slice(0, 3), null, 2)}
              </pre>
            )}
          </div>
        )}

        {incident.rowCount > 0 && (
          <p className="mt-2 text-[10px] text-mute">
            {incident.rowCount} rows scraped
            {incident.expectedRowCount > 0
              ? ` (expected ~${incident.expectedRowCount})`
              : ""}
          </p>
        )}
      </div>
      <div className="rule my-3" />
    </div>
  );
}

function CurrentCodeSection({ steps }: { steps: TemplateStep[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <p className="caps">Current scraper code</p>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-mute underline decoration-1 underline-offset-2 hover:text-ink"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded ? (
        <div className="mt-1 max-h-60 overflow-auto rounded-sm border border-line bg-wash">
          {steps.map((step, i) => {
            const code = extractCode(step);
            if (!code) return null;
            return (
              <div key={i} className="border-b border-line p-2 last:border-b-0">
                <p className="text-[9px] text-mute">
                  Step {i}{" "}
                  {Object.keys(step)
                    .filter((k) => k !== "code" && k !== "parse")
                    .join(", ")}
                </p>
                <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-[1.6]">
                  {code}
                </pre>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-mute">
          {steps.length} step{steps.length === 1 ? "" : "s"} captured. Expand
          to view the scraper code.
        </p>
      )}
      <div className="rule my-3" />
    </div>
  );
}

const BD_STEPS = [
  "planner",
  "control_preview_runner",
  "code_fixer",
  "step_preview_runner",
  "request_fulfillment_validator",
  "css_selector_extractor",
  "agent_picker",
  "html_diff",
  "step_advance",
  "user_approval",
];

function stepLabel(s: string): string {
  return s.replace(/_/g, " ");
}

function TriggeringView({
  startedAt,
  bdStep,
  completedSteps,
  onCancel,
}: {
  startedAt: number;
  bdStep: string | null;
  completedSteps: string[];
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const completedSet = new Set(completedSteps);

  return (
    <div className="py-4">
      <div className="flex items-center justify-between">
        <p className="caps text-heal">Healing in progress</p>
        <span className="font-mono text-[11px] tabular-nums text-mute">
          {formatDuration(elapsed)}
        </span>
      </div>

      <div className="mt-3 space-y-1">
        {BD_STEPS.map((s) => {
          const isDone = completedSet.has(s);
          const isCurrent = bdStep === s && !isDone;
          return (
            <div key={s} className="flex items-center gap-2 text-[10.5px]">
              {isDone ? (
                <span className="inline-block size-3 text-center text-live">
                  *
                </span>
              ) : isCurrent ? (
                <span className="inline-block size-3 animate-spin rounded-full border border-heal border-t-transparent" />
              ) : (
                <span className="inline-block size-3 text-center text-mute/30">
                  -
                </span>
              )}
              <span
                className={
                  isDone
                    ? "text-live"
                    : isCurrent
                      ? "text-ink"
                      : "text-mute/40"
                }
              >
                {stepLabel(s)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[10px] text-mute">
        Bright Data is generating a fix. This usually takes 1-5 minutes.
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full rounded-sm border border-line py-1.5 text-[11px] uppercase tracking-[0.14em] text-mute transition-colors hover:border-broken hover:text-broken"
      >
        Cancel
      </button>
    </div>
  );
}

function PendingView({
  prompt,
  diff,
  previewResult,
  startedAt,
  finishedAt,
  onApprove,
  onReject,
}: {
  prompt: string;
  diff: DiffData | null;
  previewResult: unknown[] | null;
  startedAt: number;
  finishedAt: number;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="caps text-live">Proposal ready for review</p>
        <TimingBadge startedAt={startedAt} finishedAt={finishedAt} />
      </div>

      {prompt && (
        <div className="mt-3">
          <p className="text-[10px] text-mute">Prompt sent</p>
          <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-words border border-line bg-wash p-2 text-[10.5px]">
            {prompt}
          </pre>
        </div>
      )}

      {diff ? (
        <DiffView diff={diff} />
      ) : (
        <p className="mt-3 text-[11px] text-mute">No code diff available.</p>
      )}

      {previewResult && previewResult.length > 0 && (
        <div className="mt-3">
          <p className="caps">
            Preview output ({previewResult.length} row
            {previewResult.length === 1 ? "" : "s"})
          </p>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words border border-line bg-wash p-2 text-[10.5px]">
            {JSON.stringify(previewResult.slice(0, 3), null, 2)}
          </pre>
        </div>
      )}

      <div className="rule my-3" />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          className="flex-1 rounded-sm bg-live py-1.5 text-[11px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-live/80"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          className="flex-1 rounded-sm border border-line py-1.5 text-[11px] uppercase tracking-[0.14em] text-mute transition-colors hover:border-broken hover:text-broken"
        >
          Reject
        </button>
      </div>
    </>
  );
}

function DoneView({
  verdict,
  startedAt,
  finishedAt,
  onClose,
}: {
  verdict: string;
  startedAt: number;
  finishedAt: number;
  onClose: () => void;
}) {
  const isApproved = verdict === "approved";
  return (
    <>
      <p
        className={`text-center text-[13px] font-medium ${isApproved ? "text-live" : "text-mute"}`}
      >
        {isApproved
          ? "Heal approved. The scraper has been updated."
          : verdict === "cancelled"
            ? "Heal cancelled. No changes were made."
            : "Heal rejected. No changes were made."}
      </p>
      <div className="mt-2 text-center">
        <TimingBadge startedAt={startedAt} finishedAt={finishedAt} />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full py-1.5 text-[11px] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
      >
        Close
      </button>
    </>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <>
      <p className="caps text-broken">Something went wrong</p>
      <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words border border-broken/30 bg-broken/5 p-2 text-[10.5px] text-broken">
        {message}
      </pre>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 w-full rounded-sm border border-line py-1.5 text-[11px] uppercase tracking-[0.14em] text-mute transition-colors hover:text-ink"
      >
        Try again
      </button>
    </>
  );
}

function TimingBadge({
  startedAt,
  finishedAt,
}: {
  startedAt: number;
  finishedAt: number;
}) {
  const duration = finishedAt - startedAt;
  return (
    <span className="text-[10px] tabular-nums text-mute">
      {formatTime(new Date(startedAt).toISOString())} --{" "}
      {formatDuration(duration)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DiffView
// ---------------------------------------------------------------------------

function DiffView({ diff }: { diff: DiffData }) {
  const [tab, setTab] = useState<"before" | "after">("after");
  const raw = tab === "before" ? diff.template_a : diff.template_b;
  const steps = extractSteps(raw);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1">
        <p className="caps flex-1">Scraper code</p>
        <button
          type="button"
          onClick={() => setTab("before")}
          className={`rounded-sm px-2 py-0.5 text-[10px] transition-colors ${
            tab === "before"
              ? "bg-broken/10 text-broken"
              : "text-mute hover:text-ink"
          }`}
        >
          Before
        </button>
        <button
          type="button"
          onClick={() => setTab("after")}
          className={`rounded-sm px-2 py-0.5 text-[10px] transition-colors ${
            tab === "after"
              ? "bg-live/10 text-live"
              : "text-mute hover:text-ink"
          }`}
        >
          After
        </button>
      </div>
      <div className="mt-1 max-h-60 overflow-auto rounded-sm border border-line bg-wash">
        {steps.map((step, i) => {
          const code = extractCode(step);
          if (!code) return null;
          return (
            <div key={i} className="border-b border-line p-2 last:border-b-0">
              <p className="text-[9px] text-mute">
                Step {i}{" "}
                {Object.keys(step)
                  .filter((k) => k !== "code" && k !== "parse")
                  .join(", ")}
              </p>
              <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-[1.6]">
                {code}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
