import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Session } from "@/lib/auth/session";

/**
 * APX-25: "Preview as" is read-only. The banner says every write is refused;
 * the guarded action clients are where that becomes true. Only the explicit
 * allow-list (`previewAllowedAction`) still runs during a preview.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {
    constructor(detail?: string) {
      super(detail ? `FORBIDDEN: ${detail}` : "FORBIDDEN");
    }
  }
  return { UnauthenticatedError, ForbiddenError, session: null as unknown as Session };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => h.session,
  requireRole: async (roles: string[]) => {
    if (!roles.includes(h.session.role)) throw new h.ForbiddenError("role");
    return h.session;
  },
}));

const { adminAction, authedAction, previewAllowedAction, siteAction, mapDomainError } =
  await import("./safe-action");

const work = vi.fn(async () => ({ ok: true as const }));
const write = authedAction.inputSchema(z.object({ n: z.number() })).action(work);
const adminWrite = adminAction.action(work);
const siteWrite = siteAction.action(work);
const allowed = previewAllowedAction.action(work);

function sessionAs(impersonating: Session["impersonating"]) {
  h.session = {
    userId: "00000000-0000-4000-8000-0000000000d2",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role: "admin",
    fullName: "Suresh K",
    email: null,
    impersonating,
  };
}

const PREVIEW = { role: "site" as const, projectId: "00000000-0000-4000-8000-0000000000c1" };

beforeEach(() => work.mockClear());

describe("preview is read-only (APX-25)", () => {
  it("runs a guarded action normally when not previewing", async () => {
    sessionAs(null);
    expect((await write({ n: 1 })).data).toEqual({ ok: true });
    expect((await adminWrite()).data).toEqual({ ok: true });
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("refuses every guarded action while previewing, before it runs", async () => {
    sessionAs(PREVIEW);
    for (const result of [await write({ n: 1 }), await adminWrite(), await siteWrite()]) {
      expect(result.data).toBeUndefined();
      expect(result.serverError).toBe("Preview is read-only. Exit preview to make changes.");
    }
    expect(work).not.toHaveBeenCalled();
  });

  it("still runs an allow-listed action while previewing", async () => {
    sessionAs(PREVIEW);
    expect((await allowed()).data).toEqual({ ok: true });
    expect(work).toHaveBeenCalledOnce();
  });

  it("maps the database's own PREVIEW_READ_ONLY prefix to the same copy", () => {
    expect(mapDomainError(new Error("PREVIEW_READ_ONLY: no"))).toBe(
      "Preview is read-only. Exit preview to make changes."
    );
  });
});
