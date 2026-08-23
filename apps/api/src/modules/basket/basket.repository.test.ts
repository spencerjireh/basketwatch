import { describe, expect, it } from "vitest";
import { buildStoreSeries, type StoreDayRow } from "./basket.repository.js";

const day = (store_id: string, d: string, over: Partial<StoreDayRow> = {}): StoreDayRow => ({
  store_id,
  store_name: store_id.toUpperCase(),
  d,
  priced: "15",
  expected: "15",
  total: "42.5000",
  ...over,
});

describe("buildStoreSeries", () => {
  it("returns nothing for no rows", () => {
    expect(buildStoreSeries(["2026-08-20"], [])).toEqual([]);
  });

  it("carries every calendar date, absent days as null totals", () => {
    const dates = ["2026-08-20", "2026-08-21", "2026-08-22"];
    const [series] = buildStoreSeries(dates, [
      day("acme", "2026-08-20"),
      day("acme", "2026-08-22", { total: "43.0000" }),
    ]);

    // Parallel to the basket's own points -- the chart maps by array position.
    expect(series?.points.map((p) => p.date)).toEqual(dates);
    expect(series?.points[1]).toEqual({
      date: "2026-08-21",
      total: null,
      pricedItems: 0,
      expectedItems: 15,
    });
    expect(series?.points[2]?.total).toBe(43);
  });

  it("keeps a numeric total on a partial day, with the shortfall visible", () => {
    const [series] = buildStoreSeries(
      ["2026-08-20"],
      [day("acme", "2026-08-20", { priced: "9", total: "31.2500" })],
    );

    // The store line's whole premise: partial days total what was priced.
    expect(series?.points[0]).toEqual({
      date: "2026-08-20",
      total: 31.25,
      pricedItems: 9,
      expectedItems: 15,
    });
  });

  it("orders stores by name, not by row arrival", () => {
    const series = buildStoreSeries(
      ["2026-08-20"],
      [
        day("zed", "2026-08-20", { store_name: "Zed Mart" }),
        day("acme", "2026-08-20", { store_name: "Acme Grocer" }),
      ],
    );

    expect(series.map((s) => s.storeName)).toEqual(["Acme Grocer", "Zed Mart"]);
  });
});
