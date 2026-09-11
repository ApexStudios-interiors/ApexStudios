import { describe, expect, it } from "vitest";
import { inventoryStatus } from "./service";

/** build's own three boundary cases, exactly: qty = 0, qty = reorder_level -
 *  0.001, qty = reorder_level. */
describe("inventoryStatus", () => {
  it("is critical at exactly qty = 0, regardless of reorder level", () => {
    expect(inventoryStatus(0, 50)).toBe("critical");
  });

  it("is low just under the reorder level", () => {
    expect(inventoryStatus(49.999, 50)).toBe("low");
  });

  it("is ok at exactly the reorder level — the boundary itself is not low", () => {
    expect(inventoryStatus(50, 50)).toBe("ok");
  });

  it("is ok comfortably above the reorder level", () => {
    expect(inventoryStatus(200, 50)).toBe("ok");
  });

  it("is ok when the reorder level is zero and qty is positive", () => {
    expect(inventoryStatus(5, 0)).toBe("ok");
  });
});
