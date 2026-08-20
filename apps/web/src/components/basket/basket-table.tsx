import type { BasketItem } from "@basketwatch/contract";
import { formatMoney, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The shelf edge, as a table: item, where it is cheapest, its price, and the
 * unit price underneath in small type -- which is what makes a 5 lb bag and a
 * 5 kg sack comparable at all.
 *
 * Every row carries its own currency, so formatting is per row and never global.
 */
export function BasketTable({ items }: { items: BasketItem[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
            <th className="px-1 pb-2 font-normal">Item</th>
            <th className="px-1 pb-2 font-normal">Cheapest at</th>
            <th className="px-1 pb-2 text-right font-normal">Price</th>
            <th className="px-1 pb-2 text-right font-normal">24h</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.country}-${item.itemKey}`} className="border-t border-line">
              <td className="px-1 py-2.5">
                <div className="font-medium">{item.label}</div>
                <div className="font-mono text-[11px] text-mute">
                  {item.unit} · {item.country}
                </div>
              </td>
              <td className="px-1 py-2.5 text-mute">{item.cheapestStoreName}</td>
              <td className="px-1 py-2.5 text-right">
                <div className="font-mono">
                  {formatMoney(item.price.amount, item.price.currency)}
                </div>
                {item.unitPrice ? (
                  <div className="font-mono text-[11px] text-mute">
                    {formatMoney(item.unitPrice.amount, item.unitPrice.currency)}{" "}
                    {item.unitPriceBasis}
                  </div>
                ) : null}
              </td>
              <td
                className={cn(
                  "px-1 py-2.5 text-right font-mono",
                  item.deltaPct < 0 && "text-live",
                  item.deltaPct > 0 && "text-broken",
                  item.deltaPct === 0 && "text-mute",
                )}
              >
                {item.deltaPct === 0 ? "--" : formatPct(item.deltaPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
