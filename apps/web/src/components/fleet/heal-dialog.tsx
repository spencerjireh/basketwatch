"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { approveHeal, fetchPreviewPrompt, rejectHeal, triggerHeal } from "@/app/behind/actions";

type TemplateStep = Record<string, unknown>;

interface DiffData {
  title: string;
  template_a: TemplateStep[];
  template_b: TemplateStep[];
}

type HealState =
  | { step: "loading" }
  | { step: "idle"; defaultPrompt: string | null }
  | { step: "triggering" }
  | { step: "pending"; prompt: string; diff: DiffData | null; previewResult: unknown[] | null }
  | { step: "deciding" }
  | { step: "done"; verdict: string }
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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setState({ step: "loading" });
    setPrompt("");
    fetchPreviewPrompt(scraperId).then((res) => {
      const auto = res.ok && typeof res.data.prompt === "string" ? res.data.prompt : null;
      setState({ step: "idle", defaultPrompt: auto });
      if (auto) setPrompt(auto);
    });
  }, [open, scraperId]);

  const handleClose = useCallback(() => {
    setState({ step: "loading" });
    setPrompt("");
    onClose();
  }, [onClose]);

  const handleTrigger = useCallback(async () => {
    setState({ step: "triggering" });
    const result = await triggerHeal(scraperId, prompt || undefined);
    if (!result.ok) {
      setState({ step: "error", message: JSON.stringify(result.data) });
      return;
    }
    const status = result.data.status as string;
    if (status === "pending_answer") {
      setState({
        step: "pending",
        prompt: (result.data.prompt as string) ?? prompt,
        diff: (result.data.diff as DiffData) ?? null,
        previewResult: (result.data.previewResult as unknown[]) ?? null,
      });
    } else {
      setState({ step: "error", message: `Heal returned status: ${status}` });
    }
  }, [scraperId, prompt]);

  const handleApprove = useCallback(async () => {
    setState({ step: "deciding" });
    const result = await approveHeal(scraperId);
    if (result.ok) {
      setState({ step: "done", verdict: "approved" });
    } else {
      setState({ step: "error", message: JSON.stringify(result.data) });
    }
  }, [scraperId]);

  const handleReject = useCallback(async () => {
    setState({ step: "deciding" });
    const result = await rejectHeal(scraperId);
    if (result.ok) {
      setState({ step: "done", verdict: "rejected" });
    } else {
      setState({ step: "error", message: JSON.stringify(result.data) });
    }
  }, [scraperId]);

  return (
    <dialog
      ref={ref}
      onClose={handleClose}
      onClick={(event) => {
        if (event.target === ref.current) handleClose();
      }}
      className="m-auto w-[min(92vw,640px)] rounded-sm border border-line bg-paper p-0 text-ink backdrop:bg-ink/40"
      aria-label="Heal scraper"
    >
      <div className="max-h-[85vh] overflow-y-auto px-5 py-5 font-mono text-[12px] leading-relaxed">
        <header className="text-center">
          <h2 className="font-display text-[19px]">Heal scraper</h2>
          <p className="mt-0.5 text-mute">{storeName}</p>
        </header>

        <div className="rule my-3" />

        {/* Loading preview prompt */}
        {state.step === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-heal border-t-transparent" />
            <p className="text-[11px] text-mute">Loading prompt...</p>
          </div>
        )}

        {/* Idle: show prompt textarea and trigger button */}
        {state.step === "idle" && (
          <>
            <p className="caps">Heal prompt</p>
            {state.defaultPrompt ? (
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
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="mt-2 w-full resize-none rounded-sm border border-line bg-wash px-3 py-2 text-[11px] text-ink placeholder:text-mute/60 focus:border-heal focus:outline-none"
              placeholder="e.g. Fix size_value and size_uom extraction..."
            />
            <button
              type="button"
              onClick={handleTrigger}
              disabled={!prompt.trim()}
              className="mt-3 w-full rounded-sm bg-heal py-1.5 text-[11px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-heal/80 disabled:opacity-40"
            >
              Trigger heal
            </button>
            <p className="mt-2 text-center text-[10px] text-mute">
              Sends a heal request to Bright Data (1-5 min). The scraper is not modified until you
              approve.
            </p>
          </>
        )}

        {/* Triggering: spinner */}
        {state.step === "triggering" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <span className="inline-block size-5 animate-spin rounded-full border-2 border-heal border-t-transparent" />
            <p className="text-[11px] text-mute">
              Bright Data is generating a fix... This takes 1-5 minutes.
            </p>
          </div>
        )}

        {/* Pending: show prompt, diff, preview, approve/reject */}
        {state.step === "pending" && (
          <>
            <p className="caps text-live">Proposal ready for review</p>

            <div className="mt-3">
              <p className="text-[10px] text-mute">Prompt sent</p>
              <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-words border border-line bg-wash p-2 text-[10.5px]">
                {state.prompt}
              </pre>
            </div>

            {state.diff ? (
              <DiffView diff={state.diff} />
            ) : (
              <p className="mt-3 text-[11px] text-mute">No code diff available.</p>
            )}

            {state.previewResult && state.previewResult.length > 0 ? (
              <div className="mt-3">
                <p className="caps">Preview output ({state.previewResult.length} row{state.previewResult.length === 1 ? "" : "s"})</p>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words border border-line bg-wash p-2 text-[10.5px]">
                  {JSON.stringify(state.previewResult.slice(0, 3), null, 2)}
                </pre>
              </div>
            ) : null}

            <div className="rule my-3" />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleApprove}
                className="flex-1 rounded-sm bg-live py-1.5 text-[11px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-live/80"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="flex-1 rounded-sm border border-line py-1.5 text-[11px] uppercase tracking-[0.14em] text-mute transition-colors hover:border-broken hover:text-broken"
              >
                Reject
              </button>
            </div>
          </>
        )}

        {/* Deciding */}
        {state.step === "deciding" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-heal border-t-transparent" />
            <p className="text-[11px] text-mute">Processing...</p>
          </div>
        )}

        {/* Done */}
        {state.step === "done" && (
          <>
            <p
              className={`text-center text-[13px] font-medium ${state.verdict === "approved" ? "text-live" : "text-mute"}`}
            >
              {state.verdict === "approved"
                ? "Heal approved. The scraper has been updated."
                : "Heal rejected. No changes were made."}
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-4 w-full py-1.5 text-[11px] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
            >
              Close
            </button>
          </>
        )}

        {/* Error */}
        {state.step === "error" && (
          <>
            <p className="caps text-broken">Something went wrong</p>
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words border border-broken/30 bg-broken/5 p-2 text-[10.5px] text-broken">
              {state.message}
            </pre>
            <button
              type="button"
              onClick={() => {
                setState({ step: "loading" });
                fetchPreviewPrompt(scraperId).then((res) => {
                  const auto = res.ok && typeof res.data.prompt === "string" ? res.data.prompt : null;
                  setState({ step: "idle", defaultPrompt: auto });
                  if (auto) setPrompt(auto);
                });
              }}
              className="mt-3 w-full rounded-sm border border-line py-1.5 text-[11px] uppercase tracking-[0.14em] text-mute transition-colors hover:text-ink"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

function extractCode(step: TemplateStep): string | null {
  for (const key of ["code", "parse"]) {
    if (typeof step[key] === "string") return step[key] as string;
  }
  return null;
}

function DiffView({ diff }: { diff: DiffData }) {
  const [tab, setTab] = useState<"before" | "after">("after");
  const steps = tab === "before" ? diff.template_a : diff.template_b;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1">
        <p className="caps flex-1">Scraper code</p>
        <button
          type="button"
          onClick={() => setTab("before")}
          className={`rounded-sm px-2 py-0.5 text-[10px] transition-colors ${
            tab === "before" ? "bg-broken/10 text-broken" : "text-mute hover:text-ink"
          }`}
        >
          Before
        </button>
        <button
          type="button"
          onClick={() => setTab("after")}
          className={`rounded-sm px-2 py-0.5 text-[10px] transition-colors ${
            tab === "after" ? "bg-live/10 text-live" : "text-mute hover:text-ink"
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
                Step {i} {Object.keys(step).filter((k) => k !== "code" && k !== "parse").join(", ")}
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
