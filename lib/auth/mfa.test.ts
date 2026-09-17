import { describe, expect, it } from "vitest";
import { mfaStep, requiresMfa, safeNext } from "./mfa";

describe("requiresMfa", () => {
  it("is required for owner and admin only (architecture.md T12)", () => {
    expect(requiresMfa("owner")).toBe(true);
    expect(requiresMfa("admin")).toBe(true);
    expect(requiresMfa("site")).toBe(false);
    expect(requiresMfa("client")).toBe(false);
  });
});

describe("mfaStep", () => {
  it("sends an owner/admin with no factor to enrollment — the D22 gap", () => {
    expect(mfaStep({ role: "owner", aal: "aal1", hasVerifiedTotp: false })).toBe("enroll");
    expect(mfaStep({ role: "admin", aal: "aal1", hasVerifiedTotp: false })).toBe("enroll");
  });

  it("challenges an owner/admin who has a factor but has not used it this session", () => {
    expect(mfaStep({ role: "admin", aal: "aal1", hasVerifiedTotp: true })).toBe("challenge");
  });

  it("lets an aal2 session straight through", () => {
    expect(mfaStep({ role: "owner", aal: "aal2", hasVerifiedTotp: true })).toBe("none");
  });

  it("never gates site or client", () => {
    expect(mfaStep({ role: "site", aal: "aal1", hasVerifiedTotp: false })).toBe("none");
    expect(mfaStep({ role: "client", aal: "aal1", hasVerifiedTotp: true })).toBe("none");
  });
});

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/projects/abc?tab=billing")).toBe("/projects/abc?tab=billing");
  });

  it.each([null, undefined, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)"])(
    "falls back to / for %s",
    (next) => {
      expect(safeNext(next)).toBe("/");
    }
  );
});
