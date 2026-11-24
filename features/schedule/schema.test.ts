import { describe, expect, it } from "vitest";
import { DURATION_MESSAGE, createTaskSchema, updateTaskSchema } from "./schema";

const base = {
  phaseId: "00000000-0000-4000-8000-000000000001",
  name: "Coping stone fixing",
  startDate: "2026-11-23",
  durationWeeks: "2",
};

describe("task duration (APX-40)", () => {
  it.each(["0", "", "1.5", "105", "abc"])("refuses %j with the friendly message", (durationWeeks) => {
    const r = createTaskSchema.safeParse({ ...base, durationWeeks });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe(DURATION_MESSAGE);
  });

  it("accepts 1 and 104", () => {
    expect(createTaskSchema.safeParse({ ...base, durationWeeks: "1" }).success).toBe(true);
    expect(createTaskSchema.safeParse({ ...base, durationWeeks: "104" }).success).toBe(true);
  });

  it("uses the same message on Task Detail", () => {
    const r = updateTaskSchema.safeParse({ id: base.phaseId, durationWeeks: "0" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe(DURATION_MESSAGE);
  });
});

describe("task free text", () => {
  it("asks for a name rather than saying Too small", () => {
    const r = createTaskSchema.safeParse({ ...base, name: "  " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Name is required");
  });

  it("caps the note", () => {
    expect(updateTaskSchema.safeParse({ id: base.phaseId, note: "x".repeat(2001) }).success).toBe(false);
  });
});
