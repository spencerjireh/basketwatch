import { basketItems } from "../data/mock";

/** Prices carry their own ISO currency, so formatting is per row, not global. */
const money = (currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency });

export function BasketTable() {
  return (
    <table className="basket">
      <thead>
        <tr>
          <th>Item</th>
          <th>Cheapest at</th>
          <th>Price</th>
          <th>24h</th>
        </tr>
      </thead>
      <tbody>
        {basketItems.map((item) => (
          <tr key={item.productKey}>
            <td>{item.name}</td>
            <td>{item.cheapestStore}</td>
            <td>{money(item.currency).format(item.price)}</td>
            <td className={item.deltaPct < 0 ? "delta-down" : item.deltaPct > 0 ? "delta-up" : ""}>
              {item.deltaPct === 0
                ? "—"
                : `${item.deltaPct > 0 ? "+" : ""}${item.deltaPct.toFixed(1)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
