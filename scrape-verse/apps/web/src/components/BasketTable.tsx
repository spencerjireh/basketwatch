import { basketItems } from "../data/mock";

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
          <tr key={item.name}>
            <td>{item.name}</td>
            <td>{item.cheapest}</td>
            <td>${item.price.toFixed(2)}</td>
            <td className={item.delta < 0 ? "delta-down" : item.delta > 0 ? "delta-up" : ""}>
              {item.delta === 0 ? "—" : `${item.delta > 0 ? "+" : ""}${item.delta.toFixed(1)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
