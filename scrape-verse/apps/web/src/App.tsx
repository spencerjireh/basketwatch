import { BasketChart } from "./components/BasketChart";
import { BasketTable } from "./components/BasketTable";
import { EventFeed } from "./components/EventFeed";
import { FleetBoard } from "./components/FleetBoard";
import { fleet } from "./data/mock";
import "./styles.css";

export function App() {
  const healthy = fleet.filter((s) => s.status === "healthy").length;
  const attention = fleet.length - healthy;

  return (
    <div className="shell">
      <header className="topbar">
        <h1>
          basket<span>watch</span> <small style={{ color: "var(--muted)", fontWeight: 400 }}>· self-healing price tracker</small>
        </h1>
        <div className="summary">
          <span className="pill healthy">{healthy} healthy</span>
          {attention > 0 && <span className="pill suspect">{attention} need attention</span>}
          <span className="pill healing">spider-sense active</span>
        </div>
      </header>

      <div className="grid">
        <section className="panel">
          <h2>Basket index</h2>
          <p className="sub">
            Total price of 10 staples across all tracked stores. Gaps are scraper outages; the
            engine closes them.
          </p>
          <BasketChart />
        </section>

        <section className="panel">
          <h2>Fleet health</h2>
          <FleetBoard />
        </section>

        <section className="panel">
          <h2>Today's basket</h2>
          <BasketTable />
        </section>

        <section className="panel">
          <h2>Engine activity</h2>
          <EventFeed />
        </section>
      </div>

      <p className="mock-note">
        Mock data — mirrors the orchestrator API contract. Swaps for live /api endpoints as the
        backend lands.
      </p>
    </div>
  );
}
