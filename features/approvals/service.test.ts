import { describe, expect, it } from "vitest";
import {
  approvalTypeLabel,
  canAddPhotos,
  canDecide,
  canSupersede,
  isAgedPending,
  type ApprovalStatus,
} from "./service";
import { APPROVAL_TYPES } from "./schema";

describe("approvalTypeLabel", () => {
  it("has a label for every real approval_type value", () => {
    for (const type of APPROVAL_TYPES) {
      expect(approvalTypeLabel(type)).toBeTruthy();
    }
  });

  it("matches the exact labels build/08-approvals.md's own mapping specifies", () => {
    expect(approvalTypeLabel("material_sample")).toBe("Material Sample");
    expect(approvalTypeLabel("drawing")).toBe("Drawing");
    expect(approvalTypeLabel("make_model")).toBe("Make/Model");
    expect(approvalTypeLabel("milestone")).toBe("Milestone");
    expect(approvalTypeLabel("other")).toBe("Other");
  });
});

describe("canAddPhotos / canDecide", () => {
  const statuses: ApprovalStatus[] = ["pending", "approved", "rejected"];
  it.each(statuses)("status=%s", (status) => {
    const expected = status === "pending";
    expect(canAddPhotos(status)).toBe(expected);
    expect(canDecide(status)).toBe(expected);
  });
});

describe("canSupersede", () => {
  it.each([
    ["pending", false],
    ["approved", false],
    ["rejected", true],
  ] as const)("status=%s -> %s", (status, expected) => {
    expect(canSupersede(status)).toBe(expected);
  });
});

describe("isAgedPending", () => {
  const now = new Date("2026-09-11T00:00:00Z");

  it("false when not pending, regardless of age", () => {
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isAgedPending("approved", old, now)).toBe(false);
    expect(isAgedPending("rejected", old, now)).toBe(false);
  });

  it("false when pending but under 7 days old", () => {
    const recent = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(isAgedPending("pending", recent, now)).toBe(false);
  });

  it("false exactly at 7 days", () => {
    const exact = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(isAgedPending("pending", exact, now)).toBe(false);
  });

  it("true when pending and over 7 days old", () => {
    const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isAgedPending("pending", old, now)).toBe(true);
  });
});
