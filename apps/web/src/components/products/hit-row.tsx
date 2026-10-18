import Link from "next/link";
import { routes, type ProductHit, type UnitPriceBasis } from "@basketwatch/contract";
import { Sparkline } from "@/components/ui/sparkline";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const BASIS_LABEL: Record<UnitPriceBasis, string> = {
  per_kg: "per kg",
  per_litre: "per litre",
  per_item: "each",
};

/**
 * Ever lists one product per branch (the handle ends in the branch name), so
 * a search returns the same name at the same price several times from one
 * store. Rows that agree on store, name and price fold into the first one,
 * with the count kept for its note.
 */
export function collapseListings<T extends ProductHit>(hits: T[]): { hit: T; listings: number }[] {
  const out: { hit: T; listings: number }[] = [];
  const at = new Map<string, number>();
  for (const hit of hits) {
    const key = `${hit.storeId}\u0000${hit.name.toLowerCase()}\u0000${hit.price?.amount ?? ""}`;
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, out.length);
      out.push({ hit, listings: 1 });
    } else {
      out[i]!.listings += 1;
    }
  }
  return out;
}

export function productHref(hit: Pick<ProductHit, "storeId" | "productKey">): string {
  // The API path minus its prefix: /api/products/a/b becomes /p/a/b.
  return routes.product(hit.storeId, hit.productKey).replace("/api/products/", "/p/");
}

/**
 * One store's product: the name and store on the left, then the sparkline,
 * then the shelf price large and the unit price under it. `note` is the
 * caller's extra line (a drop's percentage, an over-SRP mark).
 */
export function HitRow({
  hit,
  note,
  noteTone,
  listings = 1,
}: {
  hit: ProductHit;
  note?: string;
  noteTone?: "live" | "drift";
  /** how many identical listings this row stands for */
  listings?: number;
}) {
  return (
    <li className="border-b border-line">
      <Link
        href={productHref(hit)}
        className="group flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
            {hit.name}
          </p>
          <p className="font-mono text-[10.5px] text-mute">
            {hit.storeName}
            {hit.imprecise ? " · approx size" : ""}
            {listings > 1 ? ` · ${listings} listings` : ""}
            {note ? (
              <span className={cn(noteTone === "live" ? "text-live" : "text-drift")}>
                {" "}
                · {note}
              </span>
            ) : null}
          </p>
        </div>
        <Sparkline points={hit.spark} label={`Recent prices for ${hit.name}`} />
        <div className="w-[118px] shrink-0 text-right">
          <p className="font-mono text-[15px]">
            {hit.price ? formatMoney(hit.price.amount, hit.price.currency) : "not priced"}
          </p>
          <p className="font-mono text-[10.5px] text-mute">
            {hit.unitPrice && hit.unitPriceBasis
              ? `${formatMoney(hit.unitPrice.amount, hit.unitPrice.currency)} ${BASIS_LABEL[hit.unitPriceBasis]}`
              : "no size on the label"}
          </p>
        </div>
      </Link>
    </li>
  );
}
