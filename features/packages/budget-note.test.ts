import { describe, expect, it } from "vitest";
import { isInternalOverAllocated } from "./service";
import { createPackageSchema } from "./schema";

describe("isInternalOverAllocated (APX-40)", () => {
  it("is true only when internal is strictly more than allocated", () => {
    expect(isInternalOverAllocated("45,00,000", "50,00,000")).toBe(true);
    expect(isInternalOverAllocated("4500000", "4500000")).toBe(false);
    expect(isInternalOverAllocated("4500000", "2584054.50")).toBe(false);
  });

  it("is false while either field is not yet a valid amount", () => {
    expect(isInternalOverAllocated("", "100")).toBe(false);
    expect(isInternalOverAllocated("100", "12a")).toBe(false);
  });

  it("compares as decimals, not floats", () => {
    expect(isInternalOverAllocated("0.30", "0.3")).toBe(false);
    expect(isInternalOverAllocated("999999999999.98", "999999999999.99")).toBe(true);
  });
});

describe("createPackageSchema money", () => {
  it("accepts Indian grouping and stores the plain decimal", () => {
    const r = createPackageSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "Interiors",
      allocatedAmount: "1,80,00,000",
      internalAmount: "₹1,25,00,000.00",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.allocatedAmount).toBe("18000000");
      expect(r.data.internalAmount).toBe("12500000.00");
    }
  });
});
