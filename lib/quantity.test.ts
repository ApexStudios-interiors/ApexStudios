import { describe, expect, it } from "vitest";
import { formatQty } from "./quantity";

describe("formatQty", () => {
  it("groups digits the Indian way", () => {
    expect(formatQty(1200)).toBe("1,200");
    expect(formatQty(125000)).toBe("1,25,000");
  });

  it("keeps up to 3 decimals, without trailing zeros", () => {
    expect(formatQty(12.5)).toBe("12.5");
    expect(formatQty(0.125)).toBe("0.125");
    expect(formatQty(7)).toBe("7");
  });
});
