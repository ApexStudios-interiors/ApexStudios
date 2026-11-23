import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * APX-45: a package edit that loses the optimistic-concurrency race reports
 * the CONFLICT domain error (not "Something went wrong"), and creates leave
 * seq_no to the database trigger instead of computing max + 1 here.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    session: null as unknown as Session,
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    insertResult: { data: { id: "new-id" }, error: null } as {
      data: { id: string } | null;
      error: { code?: string; message: string } | null;
    },
    updateResult: { data: null, error: null } as {
      data: { id: string; project_id: string } | null;
      error: { message: string } | null;
    },
    selects: [] as string[],
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => h.session,
  requireRole: async () => h.session,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        insert: (row: Record<string, unknown>) => {
          h.inserts.push({ table, row });
          return { select: () => ({ single: async () => h.insertResult }) };
        },
        update: () => chain,
        select: (cols: string) => {
          h.selects.push(`${table}:${cols}`);
          return chain;
        },
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => h.updateResult,
        single: async () => ({ data: { project_id: "p1" }, error: null }),
      };
      return chain;
    },
  }),
}));

const { createPackage, createPhase, updatePackage } = await import("./actions");

const UUID = "00000000-0000-4000-8000-0000000000e1";

beforeEach(() => {
  h.session = {
    userId: "00000000-0000-4000-8000-0000000000d2",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role: "admin",
    fullName: "Admin",
    email: null,
    impersonating: null,
  };
  h.inserts.length = 0;
  h.selects.length = 0;
  h.insertResult = { data: { id: "new-id" }, error: null };
  h.updateResult = { data: null, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updatePackage", () => {
  it("a lost optimistic-concurrency race is the CONFLICT message, not a generic error", async () => {
    h.updateResult = { data: null, error: null }; // zero rows: updated_at no longer matches
    const result = await updatePackage({ id: UUID, name: "Pool", updatedAt: "2026-11-24T10:00:00Z" });
    expect(result?.serverError).toBe(
      "Someone else changed this while you were editing. Reload to see the current values."
    );
  });

  it("succeeds when the row matched", async () => {
    h.updateResult = { data: { id: UUID, project_id: "p1" }, error: null };
    const result = await updatePackage({ id: UUID, name: "Pool", updatedAt: "2026-11-24T10:00:00Z" });
    expect(result?.data).toEqual({ ok: true });
  });
});

describe("createPackage / createPhase", () => {
  it("never sends a seq_no and never reads max(seq_no) — the trigger allocates it", async () => {
    await createPackage({ projectId: UUID, name: "New", allocatedAmount: "100", internalAmount: "80" });
    await createPhase({ packageId: UUID, name: "Phase", allocatedAmount: "10", internalAmount: "8" });
    expect(h.inserts).toHaveLength(2);
    for (const { row } of h.inserts) expect(row).not.toHaveProperty("seq_no");
    expect(h.selects.some((s) => s.includes("seq_no"))).toBe(false);
  });

  it("a unique violation on create maps to CONFLICT", async () => {
    h.insertResult = { data: null, error: { code: "23505", message: "duplicate key packages_seq_uq" } };
    const result = await createPackage({
      projectId: UUID,
      name: "New",
      allocatedAmount: "100",
      internalAmount: "80",
    });
    expect(result?.serverError).toMatch(/^Someone else changed this/);
  });
});
