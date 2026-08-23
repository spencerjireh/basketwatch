import { describe, expect, it } from "vitest";
import { normalizePreviewRows } from "./preview.js";

describe("normalizePreviewRows", () => {
  it("coerces string prices and derives the product key from the url", () => {
    const rows = normalizePreviewRows([
      {
        name: "Sinandomeng Rice 5kg",
        price: "PHP 389.50",
        product_url: "https://store.ph/products/sinandomeng-5kg",
      },
    ]);
    expect(rows).toEqual([
      {
        product_key: "sinandomeng-5kg",
        name: "Sinandomeng Rice 5kg",
        price: 389.5,
        url: "https://store.ph/products/sinandomeng-5kg",
      },
    ]);
  });

  it("reads object prices and title as a name alias", () => {
    const rows = normalizePreviewRows([
      { title: "Eggs dozen", price: { value: 6.99, currency: "USD" }, url: "https://s.us/p/eggs" },
    ]);
    expect(rows[0]?.price).toBe(6.99);
    expect(rows[0]?.name).toBe("Eggs dozen");
  });

  it("flattens listing-page wrappers nesting products", () => {
    const rows = normalizePreviewRows([
      {
        input: { url: "https://s.us/collections/all" },
        products: [
          { name: "A", price: "$1.00", url: "https://s.us/p/a" },
          { name: "B", price: "$2.00", url: "https://s.us/p/b" },
        ],
      },
    ]);
    expect(rows.map((r) => r.product_key)).toEqual(["a", "b"]);
  });

  it("drops rows with no url or no parseable price -- that absence is the signal", () => {
    const rows = normalizePreviewRows([
      { name: "no url", price: "$3.00" },
      { name: "no price", url: "https://s.us/p/x", price: "call for price" },
      { name: "ok", price: "$3.00", url: "https://s.us/p/ok" },
      "not even an object",
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.product_key).toBe("ok");
  });
});
