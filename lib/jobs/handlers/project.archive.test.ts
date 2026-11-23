import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * project.archive: completed projects whose completed_at (not updated_at) is
 * more than 12 months old become archived; soft-deleted ones are left alone.
 */

type Result = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  result: { data: [], error: null } as Result,
  table: "",
  patch: null as unknown,
  filters: [] as [string, string, unknown][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      h.table = table;
      return {
        update: (patch: unknown) => {
          h.patch = patch;
          const chain = {
            eq: (col: string, val: unknown) => {
              h.filters.push(["eq", col, val]);
              return chain;
            },
            lt: (col: string, val: unknown) => {
              h.filters.push(["lt", col, val]);
              return chain;
            },
            is: (col: string, val: unknown) => {
              h.filters.push(["is", col, val]);
              return chain;
            },
            select: async () => h.result,
          };
          return chain;
        },
      };
    },
  }),
}));

const { archiveCompletedProjects } = await import("./project.archive");

const NOW = new Date("2026-11-24T00:00:00.000Z");
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.result = { data: [{ id: "p1" }, { id: "p2" }], error: null };
  h.table = "";
  h.patch = null;
  h.filters.length = 0;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  logSpy.mockRestore();
});

describe("project.archive", () => {
  it("archives completed, live projects completed more than 12 months ago", async () => {
    await archiveCompletedProjects();

    expect(h.table).toBe("projects");
    expect(h.patch).toEqual({ status: "archived" });
    const cutoff = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(h.filters).toEqual(
      expect.arrayContaining([
        ["eq", "status", "completed"],
        ["lt", "completed_at", cutoff],
        ["is", "deleted_at", null],
      ])
    );
    // Keyed on completed_at, never updated_at: a later edit must not delay it.
    expect(h.filters.some(([, col]) => col === "updated_at")).toBe(false);
    expect(String(logSpy.mock.calls[0]?.[0])).toContain("archived 2 project(s)");
  });

  it("throws the database error when the update fails", async () => {
    h.result = { data: null, error: { message: "update refused" } };
    await expect(archiveCompletedProjects()).rejects.toThrow("update refused");
  });
});
