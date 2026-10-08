import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * getScheduleForPackage reads only its own package and that package's phases
 * (narrowed in the query), and still builds exactly the schedule it built
 * when it read the whole project's and filtered — for admin (base tables) and
 * site (the role views). getScheduleForProject still reads every package.
 * The fake applies each query's own eq filters to fixed rows, so a narrowed
 * read and a full read are compared on real results.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  filters: [] as unknown[][],
  // Simulates the old full read: the new one-package narrowing is ignored, so
  // the function's own find/filter does the narrowing, as it used to.
  ignoreNarrowing: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let rows = [...(h.rows[table] ?? [])];
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => {
          h.filters.push([table, col, v]);
          const narrowing =
            ((table === "packages" || table === "v_package_site") && col === "id") ||
            ((table === "phases" || table === "v_phase_site") && col === "package_id");
          if (!(narrowing && h.ignoreNarrowing)) rows = rows.filter((r) => r[col] === v);
          return chain;
        },
        is: (col: string, v: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === v)), chain),
        in: (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), chain),
        order: () => chain,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      return chain;
    },
  }),
}));

const { getScheduleForPackage, getScheduleForProject } = await import("./queries");

const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const PKG_A = "00000000-0000-4000-8000-0000000000e1";
const PKG_B = "00000000-0000-4000-8000-0000000000e2";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d1",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const packages = [
  { id: PKG_A, project_id: PROJECT, seq_no: 1, name: "Civil", deleted_at: null },
  { id: PKG_B, project_id: PROJECT, seq_no: 2, name: "Pool", deleted_at: null },
];
const phases = [
  { id: "ph-a1", project_id: PROJECT, package_id: PKG_A, seq_no: 1, name: "Foundation", deleted_at: null },
  { id: "ph-a2", project_id: PROJECT, package_id: PKG_A, seq_no: 2, name: "Columns", deleted_at: null },
  { id: "ph-b1", project_id: PROJECT, package_id: PKG_B, seq_no: 1, name: "Excavation", deleted_at: null },
];
const tasks = [
  {
    id: "t1",
    name: "Footings",
    owner_profile_id: "p1",
    start_date: "2026-09-07",
    duration_weeks: 2,
    end_date: "2026-09-21",
    progress_pct: 50,
    phase_id: "ph-a1",
    package_id: PKG_A,
    note: null,
    deleted_at: null,
  },
];

beforeEach(() => {
  h.filters.length = 0;
  h.ignoreNarrowing = false;
  h.rows = {
    projects: [{ id: PROJECT, start_date: "2026-09-01", deleted_at: null }],
    packages,
    v_package_site: packages,
    phases,
    v_phase_site: phases,
    tasks,
    profiles: [{ id: "p1", full_name: "Anita Rao" }],
  };
});

describe("getScheduleForPackage — reads only its own package", () => {
  it.each([
    ["admin", "packages", "phases"],
    ["site", "v_package_site", "v_phase_site"],
  ] as const)(
    "%s: narrows the package and phase reads to this package in the query",
    async (role, pkgTable, phaseTable) => {
      await getScheduleForPackage(sessionAs(role), PROJECT, PKG_A);

      expect(h.filters).toContainEqual([pkgTable, "id", PKG_A]);
      expect(h.filters).toContainEqual([phaseTable, "package_id", PKG_A]);
    }
  );

  it.each(["admin", "site"] as const)(
    "%s: builds exactly the schedule the old whole-project read built",
    async (role) => {
      h.ignoreNarrowing = true;
      const before = await getScheduleForPackage(sessionAs(role), PROJECT, PKG_A);
      h.ignoreNarrowing = false;
      const after = await getScheduleForPackage(sessionAs(role), PROJECT, PKG_A);

      expect(after).toEqual(before);
      expect(after?.packageId).toBe(PKG_A);
      expect(after?.packageName).toBe("Civil");
      expect(after?.phases.flatMap((p) => p.tasks.map((t) => t.id))).toEqual(["t1"]);
      expect(after?.phases.flatMap((p) => p.tasks.map((t) => t.ownerName))).toEqual(["Anita Rao"]);
    }
  );

  it.each(["admin", "site"] as const)("%s: another package's phases and tasks never appear", async (role) => {
    h.rows.tasks = [...tasks, { ...tasks[0], id: "t-b", phase_id: "ph-b1", package_id: PKG_B }];

    const schedule = await getScheduleForPackage(sessionAs(role), PROJECT, PKG_A);

    expect(schedule?.phases.map((p) => p.id)).not.toContain("ph-b1");
    expect(schedule?.phases.flatMap((p) => p.tasks.map((t) => t.id))).toEqual(["t1"]);
  });

  it("a package of another project is still null", async () => {
    expect(
      await getScheduleForPackage(sessionAs("admin"), PROJECT, "00000000-0000-4000-8000-0000000000e9")
    ).toBeNull();
  });

  it("no project start date is still null", async () => {
    h.rows.projects = [{ id: PROJECT, start_date: null, deleted_at: null }];

    expect(await getScheduleForPackage(sessionAs("site"), PROJECT, PKG_A)).toBeNull();
  });
});

describe("getScheduleForProject — unchanged, every package", () => {
  it("does not narrow to one package", async () => {
    await getScheduleForProject(sessionAs("admin"), PROJECT);

    expect(h.filters.some((f) => f[0] === "packages" && f[1] === "id")).toBe(false);
    expect(h.filters.some((f) => f[0] === "phases" && f[1] === "package_id")).toBe(false);
  });
});
