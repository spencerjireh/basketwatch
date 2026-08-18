import { fleet } from "../data/mock";

const relative = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
};

export function FleetBoard() {
  return (
    <div className="fleet">
      {fleet.map((s) => (
        <div className="scraper" key={s.id}>
          <span className={`dot ${s.status}`} aria-hidden />
          <div className="meta">
            <div className="name">{s.store}</div>
            <div className="stats">
              {s.lastRunRows} rows · {s.nullRatePct}% nulls · last run {relative(s.lastRunAt)}
              {s.healsToday > 0 && ` · ${s.healsToday} heal${s.healsToday > 1 ? "s" : ""} today`}
            </div>
          </div>
          <span className={`pill ${s.status}`}>{s.status.replace("_", " ")}</span>
        </div>
      ))}
    </div>
  );
}
