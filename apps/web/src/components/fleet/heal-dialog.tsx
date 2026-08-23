"use client";

import { diffLines } from "diff";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type HealPreviewPromptResponse,
  type HealStatusResponse,
  healPreviewPromptResponseSchema,
  healStatusResponseSchema,
  routes,
} from "@basketwatch/contract";
import { apiGetClient } from "@/lib/api/browser";

/**
 * A window, not a control panel.
 *
 * Heals fire from the auto-heal loop or from the ops API; nothing in here can
 * start, approve or reject one. What it does is show the whole story while it
 * happens -- the evidence that opened the incident, the prompt the healer is
 * sending, the diff Bright Data proposes, and the canary that judges it.
 *
 * The two reads go straight from the browser through the /api rewrite. They
 * are public, so there is no token to hold and no server action to route
 * through, and the contract schemas mean the response arrives typed rather
 * than as a bag of unknowns.
 */
async function readStatus(scraperId: string): Promise<HealStatusResponse | null> {
  try {
    return await apiGetClient(routes.healStatus(scraperId), healStatusResponseSchema);
  } catch {
    return null;
  }
}

async function readPreviewPrompt(
  scraperId: string,
): Promise<HealPreviewPromptResponse | null> {
  try {
    return await apiGetClient(
      routes.healPreviewPrompt(scraperId),
      healPreviewPromptResponseSchema,
    );
  } catch {
    return null;
  }
}

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
  | { step: "orphaned"; diff: DiffData | null; previewResult: unknown[] | null }
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

    (async () => {
      const status = await readStatus(scraperId);

      if (status?.status === "orphaned") {
        setState({
          step: "orphaned",
          diff: (status.diff as DiffData | null) ?? null,
          previewResult: status.previewResult,
        });
        return;
      }

      if (status && status.status !== "idle" && status.attemptId) {
        const startedAt = status.startedAt ? new Date(status.startedAt).getTime() : Date.now();

        if (status.status === "pending_answer" && status.diff) {
          setState({
            step: "pending",
            prompt: "",
            diff: status.diff as DiffData,
            previewResult: status.previewResult,
            startedAt,
            finishedAt: Date.now(),
          });
          return;
        }

        setState({
          step: "triggering",
          startedAt,
          bdStep: status.step,
          completedSteps: status.completedSteps,
        });
        startPolling(startedAt);
        return;
      }

      const preview = await readPreviewPrompt(scraperId);
      setState({
        step: "idle",
        defaultPrompt: preview?.prompt ?? null,
        incident: (preview?.incident as IncidentCtx | null) ?? null,
        currentTemplate: preview?.currentTemplate ?? null,
      });
    })();

    return stopPolling;
  }, [open, scraperId]);

  const startPolling = useCallback(
    (startedAt: number) => {
      stopPolling();
      const tick = async () => {
        const status = await readStatus(scraperId);
        if (!status) {
          pollRef.current = setTimeout(tick, 4000);
          return;
        }

        if (status.status === "pending_answer") {
          pollRef.current = null;
          setState({
            step: "pending",
            prompt: "",
            diff: (status.diff as DiffData | null) ?? null,
            previewResult: status.previewResult,
            startedAt,
            finishedAt: Date.now(),
          });
        } else if (status.status === "error" || status.status === "idle") {
          pollRef.current = null;
          setState({ step: "error", message: "Heal failed on Bright Data side." });
        } else {
          setState((prev) => {
            if (prev.step !== "triggering") return prev;
            return {
              ...prev,
              bdStep: status.step ?? prev.bdStep,
              completedSteps: status.completedSteps,
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
    onClose();
  }, [onClose, stopPolling]);

  return (
    <dialog
      ref={ref}
      onClose={handleClose}
      onClick={(e) => {
        if (e.target === ref.current) handleClose();
      }}
      className="m-auto w-[min(92vw,680px)] rounded-sm border border-line bg-paper p-0 text-ink backdrop:bg-ink/40"
      aria-label="Heal detail"
    >
      <div className="max-h-[85vh] overflow-y-auto px-5 py-5 font-mono text-[12px] leading-relaxed">
        <header className="text-center">
          <h2 className="font-display text-[19px]">Self-healing</h2>
          <p className="mt-0.5 text-mute">{storeName}</p>
        </header>

        <div className="rule my-3" />

        {state.step === "loading" && <LoadingSpinner label="Loading..." />}

        {state.step === "idle" && (
          <IdleView
            incident={state.incident}
            currentTemplate={state.currentTemplate}
            defaultPrompt={state.defaultPrompt}
          />
        )}

        {state.step === "triggering" && (
          <TriggeringView
            startedAt={state.startedAt}
            bdStep={state.bdStep}
            completedSteps={state.completedSteps}
            onBackground={handleClose}
          />
        )}

        {state.step === "pending" && (
          <PendingView
            prompt={state.prompt}
            diff={state.diff}
            previewResult={state.previewResult}
            startedAt={state.startedAt}
            finishedAt={state.finishedAt}
          />
        )}

        {state.step === "orphaned" && (
          <OrphanedView diff={state.diff} previewResult={state.previewResult} />
        )}

        {state.step === "error" && (
          <ErrorView
            message={state.message}
            onRetry={() => {
              setState({ step: "loading" });
              void readPreviewPrompt(scraperId).then((preview) => {
                setState({
                  step: "idle",
                  defaultPrompt: preview?.prompt ?? null,
                  incident: (preview?.incident as IncidentCtx | null) ?? null,
                  currentTemplate: preview?.currentTemplate ?? null,
                });
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
}: {
  incident: IncidentCtx | null;
  currentTemplate: TemplateStep[] | null;
  defaultPrompt: string | null;
}) {
  return (
    <>
      {incident && <EvidenceSection incident={incident} />}

      {currentTemplate && currentTemplate.length > 0 && (
        <CurrentCodeSection steps={currentTemplate} />
      )}

      <p className="caps">Prompt the healer will send</p>
      {defaultPrompt ? (
        <>
          <p className="mt-1 text-[10px] text-mute">
            Composed from the incident evidence above. This is the instruction
            Bright Data receives.
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-line bg-wash p-2 text-[10.5px]">
            {defaultPrompt}
          </pre>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-mute">
          Nothing to fix: this scraper has no open incident, so there is no
          evidence to compose a prompt from.
        </p>
      )}

      <p className="mt-3 text-center text-[10px] text-mute">
        Heals fire on their own when a collector breaks, or from the ops API.
        Nothing on this page starts one.
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
  onBackground,
}: {
  startedAt: number;
  bdStep: string | null;
  completedSteps: string[];
  onBackground: () => void;
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
        onClick={onBackground}
        className="mt-3 w-full rounded-sm border border-heal/30 py-1.5 text-[11px] uppercase tracking-[0.14em] text-heal transition-colors hover:border-heal hover:bg-heal/5"
      >
        Close
      </button>
    </div>
  );
}

function OrphanedView({
  diff,
  previewResult,
}: {
  diff: DiffData | null;
  previewResult: unknown[] | null;
}) {
  return (
    <div className="py-4">
      <p className="caps text-drift">Orphaned heal detected</p>
      <p className="mt-2 text-[11px] text-mute">
        A heal is awaiting approval on Bright Data with no matching record here.
        Adopting or dismissing it is an ops action, from the API.
      </p>

      {diff && <DiffView diff={diff} />}

      {previewResult && previewResult.length > 0 && (
        <div className="mt-3">
          <p className="caps">Preview result</p>
          <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-line bg-wash p-2 text-[10px] leading-relaxed">
            {JSON.stringify(previewResult, null, 2)}
          </pre>
        </div>
      )}


    </div>
  );
}

function PendingView({
  prompt,
  diff,
  previewResult,
  startedAt,
  finishedAt,
}: {
  prompt: string;
  diff: DiffData | null;
  previewResult: unknown[] | null;
  startedAt: number;
  finishedAt: number;
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

      <p className="text-center text-[10px] text-mute">
        Awaiting approval on Bright Data. The scraper is untouched until someone
        approves it.
      </p>
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
  const stepsA = extractSteps(diff.template_a);
  const stepsB = extractSteps(diff.template_b);
  const maxSteps = Math.max(stepsA.length, stepsB.length);

  return (
    <div className="mt-3">
      <p className="caps">Code changes</p>
      <div className="mt-1 max-h-72 overflow-auto rounded-sm border border-line bg-wash">
        {Array.from({ length: maxSteps }, (_, i) => {
          const codeA = stepsA[i] ? extractCode(stepsA[i]) : "";
          const codeB = stepsB[i] ? extractCode(stepsB[i]) : "";
          if (!codeA && !codeB) return null;
          const changes = diffLines(codeA ?? "", codeB ?? "");
          const hasChanges = changes.some((c) => c.added || c.removed);
          if (!hasChanges) return null;
          return (
            <div key={i} className="border-b border-line last:border-b-0">
              <p className="sticky top-0 bg-wash px-2 py-1 text-[9px] text-mute">
                Step {i}
              </p>
              <pre className="text-[10px] leading-[1.6]">
                {changes.map((part, j) => {
                  if (!part.added && !part.removed) {
                    const lines = part.value.split("\n");
                    if (lines[lines.length - 1] === "") lines.pop();
                    if (lines.length <= 4) {
                      return lines.map((line, k) => (
                        <div key={`${j}-${k}`} className="px-2 text-mute/60">
                          {"  "}{line}
                        </div>
                      ));
                    }
                    return [
                      <div key={`${j}-0`} className="px-2 text-mute/60">
                        {"  "}{lines[0]}
                      </div>,
                      <div key={`${j}-sep`} className="px-2 text-mute/30 italic">
                        {"  "}... {lines.length - 2} unchanged lines ...
                      </div>,
                      <div key={`${j}-end`} className="px-2 text-mute/60">
                        {"  "}{lines[lines.length - 1]}
                      </div>,
                    ];
                  }
                  const lines = part.value.split("\n");
                  if (lines[lines.length - 1] === "") lines.pop();
                  return lines.map((line, k) => (
                    <div
                      key={`${j}-${k}`}
                      className={
                        part.added
                          ? "bg-live/8 px-2 text-live"
                          : "bg-broken/8 px-2 text-broken"
                      }
                    >
                      {part.added ? "+ " : "- "}{line}
                    </div>
                  ));
                })}
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
