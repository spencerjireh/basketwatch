import { describe, expect, it } from "vitest";
import { parseSize, toBase, unitPrice } from "./size.js";

describe("toBase", () => {
  it.each([
    [1, "kg", 1000, "g"],
    [12, "oz", 340.194, "g"],
    [1, "gal", 3785.41, "ml"],
    [1, "dozen", 12, "count"],
  ])("converts %s %s", (value, uom, quantity, baseUom) => {
    expect(toBase(value, uom)).toEqual({ quantity, baseUom });
  });

  it("returns null for a unit that says nothing about quantity", () => {
    expect(toBase(6, "pack")).toBeNull();
  });
});

describe("parseSize", () => {
  it("reads a plain size", () => {
    expect(parseSize("Alaska Evaporada Filled Milk 360ml")).toMatchObject({
      value: 360,
      uom: "ml",
      form: "plain",
      quantity: 360,
      baseUom: "ml",
    });
  });

  it("multiplies a multipack out rather than reading the unit size", () => {
    // "12 x 2g" also matches the plain pattern, which would read 2 g.
    expect(parseSize("Instant Coffee 12 x 2g")).toMatchObject({ quantity: 24, form: "multipack" });
  });

  it("resolves a fraction", () => {
    expect(parseSize("Rice 1/4 Kg")).toMatchObject({ quantity: 250, form: "fraction" });
  });

  it("takes the midpoint of a range and flags it approximate", () => {
    expect(parseSize("Whole Chicken 500g-600g")).toMatchObject({
      quantity: 550,
      form: "range",
      approximate: true,
    });
  });

  it("converts fluid ounces", () => {
    expect(parseSize("Cooking Oil 48 fl oz")).toMatchObject({ baseUom: "ml", form: "volume" });
  });

  it("reads a bare count", () => {
    expect(parseSize("Eggs 12's")).toMatchObject({ quantity: 12, baseUom: "count" });
  });

  it("flags an approximate weight", () => {
    expect(parseSize("Beef Brisket approx 1kg")?.approximate).toBe(true);
  });

  it.each(["6 Pack Assorted", "Sugar Kids Girls' Klaris Pumps", ""])(
    "returns null rather than guessing for %s",
    (title) => {
      expect(parseSize(title)).toBeNull();
    },
  );
});

describe("unitPrice", () => {
  it("reports mass per kg", () => {
    expect(unitPrice(2.99, parseSize("Rice 500g"))).toMatchObject({ basis: "per_kg", value: 5.98 });
  });

  it("reports volume per litre", () => {
    expect(unitPrice(45, parseSize("Milk 310ml"))).toMatchObject({ basis: "per_litre" });
  });

  it("reports count per item", () => {
    expect(unitPrice(6.95, parseSize("Duck Egg 6pcs"))).toMatchObject({
      basis: "per_item",
      value: 1.1583,
    });
  });

  it("carries the approximate flag through, so a midpoint is never sold as exact", () => {
    expect(unitPrice(10, parseSize("Chicken 500g-600g"))?.approximate).toBe(true);
  });

  it.each([
    ["no size", 2.99, null],
    ["no price", null, parseSize("Rice 500g")],
  ])("returns null with %s", (_label, price, size) => {
    expect(unitPrice(price, size)).toBeNull();
  });
});
