import { describe, expect, it } from "vitest";
import { spread } from "@/lib/scale";

describe("spread", () => {
  it("speaks percent under a doubling", () => {
    expect(spread(10, 15)).toBe("50%");
  });

  it("switches to multiples at a doubling", () => {
    expect(spread(10, 20)).toBe("2.0x");
    expect(spread(10, 25)).toBe("2.5x");
  });

  it("says nothing when the low end is not a price", () => {
    expect(spread(0, 5)).toBe("");
  });
});
