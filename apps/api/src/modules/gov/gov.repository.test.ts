import { describe, expect, it } from "vitest";
import { adjustmentVariant } from "./gov.repository.js";

describe("adjustmentVariant", () => {
  it("maps each pump product to the Oil Monitor's fuel family", () => {
    expect(adjustmentVariant("RON 95")).toBe("gasoline");
    expect(adjustmentVariant("RON 100")).toBe("gasoline");
    expect(adjustmentVariant("DIESEL PLUS")).toBe("diesel");
    expect(adjustmentVariant("KEROSENE")).toBe("kerosene");
    expect(adjustmentVariant("AUTO-LPG")).toBe("");
  });
});
