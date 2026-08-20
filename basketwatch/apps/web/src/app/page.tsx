import { Dashboard } from "@/components/layout/dashboard";
import {
  basketIndex,
  basketItems,
  creditBudget,
  feed,
  fleet,
  incidents,
} from "@/fixtures/dashboard";

/**
 * Server component. Today it hands over fixtures; when the read path lands it
 * awaits apiGet() for each panel and passes the same shapes down, because the
 * fixtures are typed by the contract the API implements.
 */
export default function Page() {
  return (
    <Dashboard
      fleet={fleet}
      basketIndex={basketIndex}
      basketItems={basketItems}
      feed={feed}
      incidents={incidents}
      budget={creditBudget}
    />
  );
}
