import { describe, expect, it } from "vitest";
import {
  OTHER_REASON,
  adjustmentChange,
  composeAdjustReason,
  inventorySearchFilter,
  inventoryStatus,
  normalizeInventorySearch,
} from "./service";

describe("normalizeInventorySearch", () => {
  it("treats a missing, empty or whitespace-only param as no search at all", () => {
    expect(normalizeInventorySearch(undefined)).toBeUndefined();
    expect(normalizeInventorySearch("")).toBeUndefined();
    expect(normalizeInventorySearch("   ")).toBeUndefined();
  });

  it("trims surrounding whitespace but keeps inner spaces", () => {
    expect(normalizeInventorySearch("  white cement ")).toBe("white cement");
  });

  it("accepts a single character — it is a table filter, not the global search", () => {
    expect(normalizeInventorySearch("m")).toBe("m");
  });

  it("caps the length so a pasted blob is not an unbounded ilike scan", () => {
    expect(normalizeInventorySearch("x".repeat(500))).toHaveLength(80);
  });
});

describe("inventorySearchFilter", () => {
  it("matches the term against item name OR category, as a substring", () => {
    expect(inventorySearchFilter("tile")).toBe('name.ilike."%tile%",category.ilike."%tile%"');
  });

  it("escapes LIKE wildcards so they match literally (M_20 must not match M120)", () => {
    // LIKE-escaped to `M\_20 50\%`, then each backslash doubled for the
    // PostgREST quoted string, which un-doubles it on parse.
    expect(inventorySearchFilter("M_20 50%")).toBe(
      'name.ilike."%M\\\\_20 50\\\\%%",category.ilike."%M\\\\_20 50\\\\%%"'
    );
  });

  it("drops PostgREST's own `*` wildcard, which has no escape", () => {
    expect(inventorySearchFilter("a*b")).toBe('name.ilike."%ab%",category.ilike."%ab%"');
  });

  it("quotes the value so or= separators cannot add or break conditions", () => {
    const filter = inventorySearchFilter('x",id.eq.1,(name');
    // Exactly the two conditions we built, and the injected quote is escaped.
    expect(filter).toBe('name.ilike."%x\\",id.eq.1,(name%",category.ilike."%x\\",id.eq.1,(name%"');
  });
});

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

describe("composeAdjustReason", () => {
  it("stores a preset on its own when there is no note", () => {
    expect(composeAdjustReason("Damaged", "")).toBe("Damaged");
    expect(composeAdjustReason("Damaged", "   ")).toBe("Damaged");
  });

  it("keeps the preset first when a note is added, so it stays countable", () => {
    expect(composeAdjustReason("Physical count", " Oct audit ")).toBe("Physical count: Oct audit");
  });

  it("stores only the note for Other — and nothing when there is no note, for the schema to refuse", () => {
    expect(composeAdjustReason(OTHER_REASON, " Returned to supplier ")).toBe("Returned to supplier");
    expect(composeAdjustReason(OTHER_REASON, "")).toBe("");
  });
});

describe("adjustmentChange", () => {
  it("is signed: positive adds stock, negative removes it", () => {
    expect(adjustmentChange(120, 95)).toBe(-25);
    expect(adjustmentChange(0, 40)).toBe(40);
    expect(adjustmentChange(10, 10)).toBe(0);
  });

  it("rounds to the 3 decimal places a quantity is stored at", () => {
    expect(adjustmentChange(12, 12.1)).toBe(0.1);
  });
});
