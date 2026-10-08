import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * createTaskFor / updateTaskFor — the shared task writes for the web
 * (AddTaskDialog, TaskDetailDialog) and the mobile API — with the RLS-scoped
 * client faked. What it pins down: create reads the phase through
 * v_phase_site and takes the project and package from it, never from the
 * caller; a `scope` that is not the phase's / task's own project and package
 * is NOT_FOUND before anything is written; the insert and update carry
 * exactly the web's fields (never progress); without a scope (the web) the
 * update is the web's single write, unchanged; and database errors are
 * thrown unchanged.
 */

type Result = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  phase: { data: null, error: null } as Result,
  task: { data: null, error: null } as Result,
  inserted: { data: null, error: null } as Result,
  updated: { data: null, error: null } as Result,
  calls: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      h.calls.push(["from", table]);
      let op: "read" | "insert" | "update" = "read";
      const chain = {
        select: (...a: unknown[]) => (h.calls.push(["select", ...a]), chain),
        insert: (row: unknown) => ((op = "insert"), h.calls.push(["insert", row]), chain),
        update: (patch: unknown) => ((op = "update"), h.calls.push(["update", patch]), chain),
        eq: (...a: unknown[]) => (h.calls.push(["eq", ...a]), chain),
        is: (...a: unknown[]) => (h.calls.push(["is", ...a]), chain),
        maybeSingle: async () => (table === "v_phase_site" ? h.phase : h.task),
        single: async () => (op === "insert" ? h.inserted : h.updated),
      };
      return chain;
    },
  }),
}));

const { createTaskFor, updateTaskFor } = await import("./tasks");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000e9";
const PHASE_ID = "00000000-0000-4000-8000-0000000000f1";
const TASK_ID = "00000000-0000-4000-8000-000000000701";
const OWNER_ID = "00000000-0000-4000-8000-0000000000d7";

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d5",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "site",
  fullName: "Test User",
  email: null,
  impersonating: null,
};

const CREATE = {
  phaseId: PHASE_ID,
  name: "Shuttering",
  ownerProfileId: OWNER_ID,
  startDate: "2026-10-12",
  durationWeeks: 3,
};

function writes() {
  return h.calls.filter((c) => c[0] === "insert" || c[0] === "update");
}

beforeEach(() => {
  h.phase = { data: { project_id: PROJECT_ID, package_id: PACKAGE_ID }, error: null };
  h.task = { data: { id: TASK_ID, project_id: PROJECT_ID, package_id: PACKAGE_ID }, error: null };
  h.inserted = { data: { id: TASK_ID }, error: null };
  h.updated = { data: { id: TASK_ID, project_id: PROJECT_ID }, error: null };
  h.calls.length = 0;
});

describe("createTaskFor", () => {
  it("reads the phase via v_phase_site and inserts with its project and package and the session's org", async () => {
    const result = await createTaskFor(SESSION, CREATE);

    expect(h.calls.slice(0, 3)).toEqual([
      ["from", "v_phase_site"],
      ["select", "project_id, package_id"],
      ["eq", "id", PHASE_ID],
    ]);
    expect(writes()).toEqual([
      [
        "insert",
        {
          org_id: SESSION.orgId,
          project_id: PROJECT_ID,
          package_id: PACKAGE_ID,
          phase_id: PHASE_ID,
          name: "Shuttering",
          owner_profile_id: OWNER_ID,
          start_date: "2026-10-12",
          duration_weeks: 3,
        },
      ],
    ]);
    expect(result).toEqual({ id: TASK_ID, projectId: PROJECT_ID, packageId: PACKAGE_ID });
  });

  it("stores no owner as null", async () => {
    await createTaskFor(SESSION, { ...CREATE, ownerProfileId: undefined });

    expect((writes()[0]?.[1] as Record<string, unknown>).owner_profile_id).toBeNull();
  });

  it("accepts a phase that is the scope's own project and package", async () => {
    await expect(
      createTaskFor(SESSION, CREATE, { projectId: PROJECT_ID, packageId: PACKAGE_ID })
    ).resolves.toMatchObject({ id: TASK_ID });
  });

  it.each([
    ["another package", { projectId: PROJECT_ID, packageId: OTHER_ID }],
    ["another project", { projectId: OTHER_ID, packageId: PACKAGE_ID }],
  ])("refuses a phase of %s as NOT_FOUND, before any insert", async (_label, scope) => {
    await expect(createTaskFor(SESSION, CREATE, scope)).rejects.toThrow(/^NOT_FOUND: /);
    expect(writes()).toEqual([]);
  });

  it("is NOT_FOUND for a phase the session cannot see (or that does not exist), before any insert", async () => {
    h.phase = { data: null, error: null };

    await expect(createTaskFor(SESSION, CREATE)).rejects.toThrow("NOT_FOUND: that phase no longer exists");
    expect(writes()).toEqual([]);
  });

  it("throws the database's own error unchanged", async () => {
    h.inserted = {
      data: null,
      error: { message: 'new row violates row-level security policy for table "tasks"' },
    };

    await expect(createTaskFor(SESSION, CREATE)).rejects.toThrow(
      "new row violates row-level security policy"
    );
  });
});

describe("updateTaskFor", () => {
  it("without a scope (the web) is the single update, unchanged — no read first", async () => {
    const result = await updateTaskFor(SESSION, { id: TASK_ID, name: "Deshuttering", note: "" });

    expect(h.calls).toEqual([
      ["from", "tasks"],
      ["update", { name: "Deshuttering", note: "" }],
      ["eq", "id", TASK_ID],
      ["select", "id, project_id"],
    ]);
    expect(result).toEqual({ id: TASK_ID, projectId: PROJECT_ID });
  });

  it("writes exactly the fields given, mapped to their columns — never progress", async () => {
    await updateTaskFor(SESSION, { id: TASK_ID, startDate: "2026-11-02", durationWeeks: 5 });

    expect(writes()).toEqual([["update", { start_date: "2026-11-02", duration_weeks: 5 }]]);
  });

  it("with a scope reads the live task first, then updates it", async () => {
    await updateTaskFor(
      SESSION,
      { id: TASK_ID, name: "x" },
      { projectId: PROJECT_ID, packageId: PACKAGE_ID }
    );

    expect(h.calls.slice(0, 4)).toEqual([
      ["from", "tasks"],
      ["select", "id, project_id, package_id"],
      ["eq", "id", TASK_ID],
      ["is", "deleted_at", null],
    ]);
    expect(writes()).toEqual([["update", { name: "x" }]]);
  });

  it.each([
    ["another package", { projectId: PROJECT_ID, packageId: OTHER_ID }],
    ["another project", { projectId: OTHER_ID, packageId: PACKAGE_ID }],
  ])("refuses a task of %s as NOT_FOUND, before any update", async (_label, scope) => {
    await expect(updateTaskFor(SESSION, { id: TASK_ID, name: "x" }, scope)).rejects.toThrow(/^NOT_FOUND: /);
    expect(writes()).toEqual([]);
  });

  it("is NOT_FOUND for a deleted or invisible task when scoped, before any update", async () => {
    h.task = { data: null, error: null };

    await expect(
      updateTaskFor(SESSION, { id: TASK_ID, name: "x" }, { projectId: PROJECT_ID, packageId: PACKAGE_ID })
    ).rejects.toThrow("NOT_FOUND: this task no longer exists");
    expect(writes()).toEqual([]);
  });

  it("throws the database's own error unchanged", async () => {
    h.updated = { data: null, error: { message: "permission denied for table tasks" } };

    await expect(updateTaskFor(SESSION, { id: TASK_ID, name: "x" })).rejects.toThrow(
      "permission denied for table tasks"
    );
  });
});
