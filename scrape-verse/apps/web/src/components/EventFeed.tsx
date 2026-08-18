import type { FeedEventKind } from "@scrape-verse/shared";
import { feed } from "../data/mock";

const kindColor: Record<FeedEventKind, string> = {
  breakage: "var(--bad)",
  healing: "var(--blue)",
  healed: "var(--ok)",
  price_drop: "var(--warn)",
  escalation: "var(--bad)",
};

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function EventFeed() {
  return (
    <div className="feed">
      {feed.map((e) => (
        <div className="event" key={e.id}>
          <div className="rail">
            <span className="dot" style={{ background: kindColor[e.kind] }} aria-hidden />
          </div>
          <div>
            <div className="when">
              {time(e.at)} · <span className="who">{e.scraper}</span>
            </div>
            <div className="what">{e.summary}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
