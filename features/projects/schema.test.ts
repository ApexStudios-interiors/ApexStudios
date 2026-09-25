import { describe, expect, it } from "vitest";
import { createProjectSchema, updateProjectSchema } from "./schema";

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

/**
 * The edit path must refuse exactly what the create path refuses — otherwise a
 * location the New Project dialog rejects becomes settable by editing instead.
 * Nothing in the app calls `updateProject` today; these tests are what stops
 * the rule being rediscovered when the edit screen is built.
 */
describe("updateProjectSchema", () => {
  const id = "22222222-2222-4222-8222-222222222222";

  it("accepts a real location", () => {
    expect(updateProjectSchema.safeParse({ id, location: "Ghanpur, Hyderabad" }).success).toBe(true);
  });

  it("keeps location optional — omitted and empty are both fine", () => {
    expect(updateProjectSchema.safeParse({ id }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ id, location: "  " }).success).toBe(true);
  });

  it("rejects a location that is only a phone number", () => {
    expect(updateProjectSchema.safeParse({ id, location: "98765456789" }).success).toBe(false);
  });

  it("rejects a location longer than 200 characters", () => {
    expect(updateProjectSchema.safeParse({ id, location: `A${"b".repeat(200)}` }).success).toBe(false);
  });

  it("rejects a name that is only whitespace, as create does", () => {
    expect(updateProjectSchema.safeParse({ id, name: "   " }).success).toBe(false);
  });
});
