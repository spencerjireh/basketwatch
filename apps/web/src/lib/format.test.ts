import { describe, expect, it } from "vitest";
import {
  formatBasis,
  formatDateTime,
  formatDay,
  formatMoney,
  formatMoneyAxis,
  formatPct,
  formatQuantity,
  formatRelative,
  spellNumber,
} from "@/lib/format";

describe("formatDateTime", () => {
  it("renders in UTC with an explicit suffix", () => {
    expect(formatDateTime("2026-08-24T06:12:00Z")).toBe("Aug 24, 06:12 UTC");
  });

  it("keeps midnight on the 24-hour clock", () => {
    expect(formatDateTime("2026-08-24T00:05:00Z")).toBe("Aug 24, 00:05 UTC");
  });
});

describe("formatDay", () => {
  it("reads the date part only, ignoring the time", () => {
    expect(formatDay("2026-08-24T23:59:59Z")).toBe("Aug 24");
  });
});

describe("formatMoney", () => {
  it("formats USD with cents", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
  });

  it("keeps each row's own currency", () => {
    expect(formatMoney(89, "PHP")).toBe("₱89.00");
  });
});

describe("formatMoneyAxis", () => {
  it("drops cents on axis ticks", () => {
    expect(formatMoneyAxis(44.12, "USD")).toBe("$44");
  });
});

describe("spellNumber", () => {
  it("spells small counts", () => {
    expect(spellNumber(0)).toBe("no");
    expect(spellNumber(3)).toBe("three");
    expect(spellNumber(15)).toBe("fifteen");
  });

  it("falls back to digits past fifteen", () => {
    expect(spellNumber(16)).toBe("16");
  });
});

describe("formatPct", () => {
  it("signs increases and keeps one decimal", () => {
    expect(formatPct(2.55)).toBe("+2.5%");
    expect(formatPct(-1.24)).toBe("-1.2%");
  });

  it("shows zero without a sign", () => {
    expect(formatPct(0)).toBe("0.0%");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-08-24T12:00:00Z");

  it("collapses under a minute", () => {
    expect(formatRelative("2026-08-24T11:59:40Z", now)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(formatRelative("2026-08-24T11:55:00Z", now)).toBe("5m ago");
    expect(formatRelative("2026-08-24T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelative("2026-08-22T12:00:00Z", now)).toBe("2d ago");
  });
});

describe("formatQuantity", () => {
  it("shows bare numbers for counts", () => {
    expect(formatQuantity(12, "count")).toBe("12");
  });

  it("rewrites sub-unit weights and volumes", () => {
    expect(formatQuantity(0.5, "kg")).toBe("500 g");
    expect(formatQuantity(0.25, "l")).toBe("250 ml");
  });

  it("keeps whole units as-is", () => {
    expect(formatQuantity(1.5, "kg")).toBe("1.5 kg");
  });

  it("survives a null uom", () => {
    expect(formatQuantity(2, null)).toBe("2");
  });
});

describe("formatBasis", () => {
  it("maps the known bases", () => {
    expect(formatBasis("per_kg")).toBe("per kg");
    expect(formatBasis("per_item")).toBe("each");
  });

  it("says nothing for null or unknown", () => {
    expect(formatBasis(null)).toBe("");
    expect(formatBasis("per_furlong")).toBe("");
  });
});
