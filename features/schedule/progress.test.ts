import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * setTaskProgressFor — the shared write for the web slider and the mobile
 * API — with the RLS-scoped client faked. What it pins down: the task is read
 * first (a task this session cannot see is NOT_FOUND), a `scope` that is not
 * the task's own project and package is refused BEFORE anything is written,
 * the RPC gets the validated progress, and its errors are thrown unchanged.
 * rpc_set_task_progress itself is tested against Postgres in
 * tests/integration/schedule.test.ts.
 */

const h = vi.hoisted(() => ({
  task: { data: null as unknown, error: null as { message: string } | null },
  rpc: vi.fn(),
  reads: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: h.rpc,
    from: (table: string) => {
      h.reads.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => (h.reads.push(["select", ...a]), chain),
        eq: (...a: unknown[]) => (h.reads.push(["eq", ...a]), chain),
        is: (...a: unknown[]) => (h.reads.push(["is", ...a]), chain),
        maybeSingle: async () => h.task,
      };
      return chain;
    },
  }),
}));

const { setTaskProgressFor } = await import("./progress");

const TASK_ID = "00000000-0000-4000-8000-000000000701";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d5",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "site",
  fullName: "Test User",
  email: null,
  impersonating: null,
};

beforeEach(() => {
  h.task = { data: { id: TASK_ID, project_id: PROJECT_ID, package_id: PACKAGE_ID }, error: null };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ error: null });
  h.reads.length = 0;
});

describe("setTaskProgressFor", () => {
  it("reads the live task, sets its progress through the RPC and returns it with its project and package", async () => {
    const result = await setTaskProgressFor(SESSION, { id: TASK_ID, progressPct: 60 });

    expect(h.reads).toEqual([
      ["from", "tasks"],
      ["select", "id, project_id, package_id"],
      ["eq", "id", TASK_ID],
      ["is", "deleted_at", null],
    ]);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_set_task_progress", { p_task_id: TASK_ID, p_pct: 60 });
    expect(result).toEqual({ id: TASK_ID, progressPct: 60, projectId: PROJECT_ID, packageId: PACKAGE_ID });
  });

  it("accepts the task's own project and package as scope", async () => {
    await setTaskProgressFor(
      SESSION,
      { id: TASK_ID, progressPct: 100 },
      { projectId: PROJECT_ID, packageId: PACKAGE_ID }
    );

    expect(h.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["another package", { projectId: PROJECT_ID, packageId: "00000000-0000-4000-8000-0000000000e2" }],
    ["another project", { projectId: "00000000-0000-4000-8000-0000000000c2", packageId: PACKAGE_ID }],
  ])("refuses a scope of %s with NOT_FOUND, writing nothing", async (_label, scope) => {
    await expect(setTaskProgressFor(SESSION, { id: TASK_ID, progressPct: 50 }, scope)).rejects.toThrow(
      "NOT_FOUND: this task does not belong to this package"
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses a task this session cannot see (or that does not exist) with NOT_FOUND, writing nothing", async () => {
    h.task = { data: null, error: null };

    await expect(setTaskProgressFor(SESSION, { id: TASK_ID, progressPct: 50 })).rejects.toThrow(
      "NOT_FOUND: this task no longer exists"
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "FORBIDDEN: rpc_set_task_progress requires project membership and admin/site",
    "REASON_REQUIRED: progress must be between 0 and 100",
    'relation "tasks" does not exist',
  ])("throws the RPC's error unchanged: %s", async (message) => {
    h.rpc.mockResolvedValue({ error: { message } });

    await expect(setTaskProgressFor(SESSION, { id: TASK_ID, progressPct: 50 })).rejects.toThrow(message);
  });

  it("throws the task lookup's own error unchanged", async () => {
    h.task = { data: null, error: { message: "tasks lookup failed" } };

    await expect(setTaskProgressFor(SESSION, { id: TASK_ID, progressPct: 50 })).rejects.toThrow(
      "tasks lookup failed"
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
