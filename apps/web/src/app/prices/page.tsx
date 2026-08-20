import { ProductSearch } from "@/components/products/product-search";
import { Panel } from "@/components/ui/panel";

export const metadata = {
  title: "Prices — Basketwatch",
  description: "Search every product in the catalogue and compare unit prices across stores.",
};

/**
 * The catalogue.
 *
 * The basket is ten curated staples; this is the other 28,000 rows behind them.
 * Nothing else in the product reaches them, and a price tracker you cannot look
 * a product up in is not a price tracker.
 */
export default function PricesPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-[840px] px-5 pb-24 pt-8">
      <section className="max-w-[58ch]">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em] [font-stretch:expanded]">
          Every product we track
        </h1>
        <p className="mt-2.5 text-[14px] text-mute">
          The unit price is the number that matters, and it is the one stores put in the smallest
          type. It is the large one here.
        </p>
      </section>

      <Panel
        title="Search"
        caption="Across every store at once. Filter by unit to compare like with like."
        className="mt-6"
      >
        <ProductSearch />
      </Panel>
    </main>
  );
}
