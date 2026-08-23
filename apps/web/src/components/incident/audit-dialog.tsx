"use client";

import { useEffect, useRef } from "react";
import type { Incident } from "@basketwatch/contract";
import { formatDateTime, formatMoney } from "@/lib/format";

/**
 * The heal audit: an itemised ledger of what the machine did and what each
 * attempt cost, printed as quiet type on a paper card.
 *
 * Built on the native <dialog> element. showModal() gives focus trapping,
 * escape-to-close, an inert backdrop and correct ARIA from the platform, which
 * is everything a component library would have been imported for.
 */
export function AuditDialog({
  incident,
  onClose,
}: {
  incident: Incident | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (incident && !dialog.open) dialog.showModal();
    if (!incident && dialog.open) dialog.close();
  }, [incident]);

  // An incident carries no country, so there is no honest currency to print
  // until an attempt has actually spent something.
  const totalSpent = incident?.attempts.reduce((sum, a) => sum + a.creditsSpent.amount, 0) ?? 0;
  const currency = incident?.attempts[0]?.creditsSpent.currency ?? null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop closes. The dialog element itself fills the
        // backdrop area, so compare against the content box.
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[min(92vw,440px)] rounded-sm border border-line bg-paper p-0 text-ink backdrop:bg-ink/40"
      aria-label="Heal audit"
    >
      {incident ? (
        <div className="max-h-[80vh] overflow-y-auto px-5 py-5 font-mono text-[12px] leading-relaxed">
          <header className="text-center">
            <h2 className="font-display text-[19px]">Heal audit</h2>
          </header>

          <div className="rule my-3" />

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-mute">Store</dt>
            <dd className="text-right">{incident.storeName}</dd>
            <dt className="text-mute">Incident</dt>
            <dd className="text-right">{incident.id}</dd>
            <dt className="text-mute">Kind</dt>
            <dd className="text-right">{incident.kind}</dd>
            <dt className="text-mute">State</dt>
            <dd className="text-right uppercase">{incident.state}</dd>
            <dt className="text-mute">Opened</dt>
            <dd className="text-right">{formatDateTime(incident.openedAt)}</dd>
            {incident.collectorId ? (
              <>
                <dt className="text-mute">Collector</dt>
                <dd className="truncate text-right">{incident.collectorId}</dd>
              </>
            ) : null}
          </dl>

          <div className="rule my-3" />

          <p className="caps">What broke</p>
          <p className="mt-1">{incident.summary}</p>
          <ul className="mt-2 space-y-0.5">
            {incident.evidence.failedChecks.map((check, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span className="text-mute">
                  {check.check} [{check.severity}]
                </span>
                <span className="text-right">{check.detail}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3">
              <span className="text-mute">rows</span>
              <span>
                {incident.evidence.rowCount} of ~{incident.evidence.expectedRowCount}
              </span>
            </li>
          </ul>

          <div className="rule my-3" />

          <p className="caps">Attempts ({incident.attempts.length})</p>

          {incident.attempts.map((attempt) => (
            <article key={attempt.id} className="mt-3">
              <div className="flex justify-between font-bold">
                <span>Attempt {attempt.attempt}</span>
                <span>{attempt.verdict ? attempt.verdict.toUpperCase() : "IN FLIGHT"}</span>
              </div>

              <p className="mt-1 text-mute">Diagnosis</p>
              <p>{attempt.diagnosis}</p>

              <p className="mt-1.5 text-mute">Prompt</p>
              <p>&ldquo;{attempt.healPrompt}&rdquo;</p>

              {attempt.studioDiff ? (
                <>
                  <p className="mt-1.5 text-mute">Diff</p>
                  <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words border border-line bg-wash p-1.5 text-[10.5px]">
                    {attempt.studioDiff}
                  </pre>
                </>
              ) : null}

              {attempt.canary ? (
                <p className="mt-1.5">
                  <span className="text-mute">Canary </span>
                  {attempt.canary.rows} rows, {attempt.canary.nullRatePct}% null &rarr;{" "}
                  {attempt.canary.status}
                </p>
              ) : null}

              <div className="mt-1 flex justify-between">
                <span className="text-mute">Cost</span>
                <span>
                  {formatMoney(attempt.creditsSpent.amount, attempt.creditsSpent.currency)}
                </span>
              </div>
            </article>
          ))}

          <div className="rule my-3" />

          <div className="flex justify-between text-[13px] font-bold">
            <span>Total credits</span>
            <span>{currency ? formatMoney(totalSpent, currency) : "--"}</span>
          </div>

          <p className="caps mt-4 text-center">Every repair, itemised</p>

          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full py-1.5 text-[11px] uppercase tracking-[0.14em] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
          >
            Close
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
