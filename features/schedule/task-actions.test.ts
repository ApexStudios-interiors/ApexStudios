import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The web's createTask / updateTask through next-safe-action, with the
 * session faked and the shared helpers (./tasks.ts, tested in
 * ./tasks.test.ts) mocked — pinning that moving the writes into ./tasks.ts
 * changed nothing for the web: admin/site only, the validated input and the
 * action's own session handed over, the same answers, the same cache
 * refresh.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {
    constructor(detail?: string) {
      super(detail ? `FORBIDDEN: ${detail}` : "FORBIDDEN");
    }
  }
  return {
    UnauthenticatedError,
    ForbiddenError,
    session: null as unknown as Session,
    createTaskFor: vi.fn(),
    updateTaskFor: vi.fn(),
    updateTag: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath, updateTag: h.updateTag }));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => h.session,
  requireRole: async (roles: string[]) => {
    if (!roles.includes(h.session.role)) throw new h.ForbiddenError("role");
    return h.session;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./tasks", () => ({ createTaskFor: h.createTaskFor, updateTaskFor: h.updateTaskFor }));

const { createTask, updateTask } = await import("./actions");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const PHASE_ID = "00000000-0000-4000-8000-0000000000f1";
const TASK_ID = "00000000-0000-4000-8000-000000000701";

function sessionAs(role: Session["role"]) {
  h.session = {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "x",
    email: null,
    impersonating: null,
  };
}

beforeEach(() => {
  sessionAs("site");
  h.createTaskFor.mockReset();
  h.createTaskFor.mockResolvedValue({ id: TASK_ID, projectId: PROJECT_ID, packageId: PACKAGE_ID });
  h.updateTaskFor.mockReset();
  h.updateTaskFor.mockResolvedValue({ id: TASK_ID, projectId: PROJECT_ID });
  h.updateTag.mockReset();
  h.revalidatePath.mockReset();
});

describe("createTask (web action)", () => {
  it.each(["admin", "site"] as const)(
    "creates for %s through the shared helper and refreshes the project",
    async (role) => {
      sessionAs(role);

      const result = await createTask({
        phaseId: PHASE_ID,
        name: " Shuttering ",
        ownerProfileId: "",
        startDate: "2026-10-12",
        durationWeeks: 3,
      });

      expect(result?.data).toEqual({ id: TASK_ID });
      expect(h.createTaskFor).toHaveBeenCalledExactlyOnceWith(h.session, {
        phaseId: PHASE_ID,
        name: "Shuttering",
        ownerProfileId: undefined,
        startDate: "2026-10-12",
        durationWeeks: 3,
      });
      expect(h.updateTag).toHaveBeenCalledWith(`project:${PROJECT_ID}`);
      expect(h.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`, "layout");
    }
  );

  it("refuses a client before any write", async () => {
    sessionAs("client");

    const result = await createTask({
      phaseId: PHASE_ID,
      name: "x",
      startDate: "2026-10-12",
      durationWeeks: 1,
    });

    expect(result?.data).toBeUndefined();
    expect(h.createTaskFor).not.toHaveBeenCalled();
  });
});

describe("updateTask (web action)", () => {
  it("updates through the shared helper (no scope), answers { ok: true } and refreshes the project", async () => {
    const result = await updateTask({ id: TASK_ID, durationWeeks: 4, note: "  ok  " });

    expect(result?.data).toEqual({ ok: true });
    expect(h.updateTaskFor).toHaveBeenCalledExactlyOnceWith(h.session, {
      id: TASK_ID,
      durationWeeks: 4,
      note: "ok",
    });
    expect(h.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`, "layout");
  });

  it("refuses a client before any write", async () => {
    sessionAs("client");

    const result = await updateTask({ id: TASK_ID, name: "x" });

    expect(result?.data).toBeUndefined();
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });
});
