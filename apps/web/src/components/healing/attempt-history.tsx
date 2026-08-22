import type { Incident } from "@basketwatch/contract";
import { formatDateTime, formatMoney } from "@/lib/format";

/**
 * The ledger: every heal attempt ever made, newest first.
 *
 * It reads from the incidents already on the page rather than a new endpoint,
 * because GET /api/incidents is deliberately fat -- evidence and every attempt
 * travel with the incident so the audit view renders from one request.
 *
 * Each row is an index into AuditDialog rather than a second rendering of the
 * same data. The dialog already shows diagnosis, prompt, Studio diff, canary
 * and cost per attempt; repeating that here would be two places to keep true.
 */
export function AttemptHistory({
  incidents,
  onOpenIncident,
}: {
  incidents: Incident[];
  onOpenIncident: (incidentId: string) => void;
}) {
  const attempts = incidents
    .flatMap((incident) => incident.attempts.map((attempt) => ({ incident, attempt })))
    .sort((a, b) => b.attempt.startedAt.localeCompare(a.attempt.startedAt));

  if (attempts.length === 0) {
    return (
      <p className="max-w-[72ch] text-[13px] text-mute">
        No repairs yet. When a collector stops returning usable rows, the loop opens an incident,
        sends Bright Data the evidence, and files what came back here — including the ones that
        were rejected.
      </p>
    );
  }

  const total = attempts.reduce((sum, { attempt }) => sum + attempt.creditsSpent.amount, 0);
  const currency = attempts[0]!.attempt.creditsSpent.currency;

  return (
    <div>
      <p className="max-w-[72ch] text-[13px] text-mute">
        {attempts.length} attempt{attempts.length === 1 ? "" : "s"} across{" "}
        {incidents.filter((i) => i.attempts.length > 0).length} incident
        {incidents.filter((i) => i.attempts.length > 0).length === 1 ? "" : "s"}, costing{" "}
        {formatMoney(total, currency)}. A rejected repair costs the same as an accepted one, so
        both are here.
      </p>

      <ul className="mt-3 flex flex-col">
        {attempts.map(({ incident, attempt }) => (
          <li
            key={attempt.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2.5 last:border-b-0"
          >
            <span className="font-mono text-[10px] text-mute">
              {formatDateTime(attempt.startedAt)}
            </span>
            <span className="text-[13px]">{incident.storeName}</span>
            <span className="font-mono text-[10px] text-mute">attempt {attempt.attempt}</span>
            <span className={`font-mono text-[10px] ${verdictTone(attempt.verdict)}`}>
              {attempt.verdict ?? "in flight"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-mute">
              {attempt.healPrompt}
            </span>
            <span className="font-mono text-[10px] text-mute">
              {formatMoney(attempt.creditsSpent.amount, attempt.creditsSpent.currency)}
            </span>
            <button
              type="button"
              onClick={() => onOpenIncident(incident.id)}
              className="font-mono text-[11px] text-mute underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
            >
              open audit
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function verdictTone(verdict: string | null): string {
  if (verdict === "approved") return "text-live";
  if (verdict === "rejected") return "text-mute";
  if (verdict === "failed") return "text-broken";
  return "text-heal";
}
