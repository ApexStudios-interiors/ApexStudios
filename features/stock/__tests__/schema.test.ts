import { describe, expect, it } from "vitest";
import { todayIst } from "@/lib/dates";
import { createStockRequestSchema } from "../schema";

const base = {
  projectId: "11111111-1111-4111-8111-111111111111",
  packageId: "22222222-2222-4222-8222-222222222222",
  materialName: "Pool-grade vitrified tile 300x300",
  unit: "nos",
  neededBy: todayIst(),
};

function messagesFor(input: Record<string, unknown>, path: string): string[] {
  const result = createStockRequestSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.filter((i) => i.path[0] === path).map((i) => i.message);
}

describe("createStockRequestSchema — quantity", () => {
  it("rejects a negative quantity with a message the form can show", () => {
    expect(messagesFor({ ...base, qty: -666 }, "qty")).toEqual(["Quantity must be positive"]);
  });

  it("rejects zero", () => {
    expect(messagesFor({ ...base, qty: 0 }, "qty")).toEqual(["Quantity must be positive"]);
  });

  it("accepts a positive fractional quantity", () => {
    expect(createStockRequestSchema.safeParse({ ...base, qty: 2.5 }).success).toBe(true);
  });
});

describe("createStockRequestSchema — rate", () => {
  it("rejects a negative rate with a message the form can show", () => {
    expect(messagesFor({ ...base, qty: 1, rate: -5 }, "rate")).toEqual(["Rate cannot be negative"]);
  });

  it("accepts zero and a positive rate", () => {
    expect(createStockRequestSchema.safeParse({ ...base, qty: 1, rate: 0 }).success).toBe(true);
    expect(createStockRequestSchema.safeParse({ ...base, qty: 1, rate: 12.5 }).success).toBe(true);
  });

  it("treats a blank rate as not specified rather than zero", () => {
    const result = createStockRequestSchema.safeParse({ ...base, qty: 1, rate: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rate).toBeUndefined();
  });
});
