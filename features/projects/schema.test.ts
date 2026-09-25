import { describe, expect, it } from "vitest";
import { createProjectSchema } from "./schema";

/**
 * The form applies these rules too, but the form is a convenience: this is the
 * schema `createProject` parses, so it is what a crafted request meets.
 */
const base = {
  name: "Model Villas Interiors",
  clientId: "11111111-1111-4111-8111-111111111111",
  startDate: "2026-09-17",
};

describe("createProjectSchema", () => {
  it("accepts a real location and well-formed packages", () => {
    const result = createProjectSchema.safeParse({
      ...base,
      location: "Ghanpur, Hyderabad",
      packages: ["Interiors", "MEP & HVAC", "Block-A / Tower 2"],
    });
    expect(result.success).toBe(true);
  });

  it("still accepts an omitted or empty location", () => {
    expect(createProjectSchema.safeParse(base).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...base, location: "  " }).success).toBe(true);
  });

  it("rejects a location that is only a phone number", () => {
    const result = createProjectSchema.safeParse({ ...base, location: "98765456789" });
    expect(result.success).toBe(false);
  });

  it("rejects a location longer than 200 characters", () => {
    const result = createProjectSchema.safeParse({ ...base, location: `A${"b".repeat(200)}` });
    expect(result.success).toBe(false);
  });

  it("rejects a package name with disallowed characters and names it", () => {
    const result = createProjectSchema.safeParse({ ...base, packages: ["Facade !@#$%^&*"] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("Facade !@#$%^&*");
  });

  it("rejects a package name longer than 60 characters", () => {
    const result = createProjectSchema.safeParse({ ...base, packages: ["A".repeat(61)] });
    expect(result.success).toBe(false);
  });

  it("tolerates blank entries — a trailing comma is a typo, not an error", () => {
    const result = createProjectSchema.safeParse({ ...base, packages: ["Interiors", "", "  "] });
    expect(result.success).toBe(true);
  });
});
