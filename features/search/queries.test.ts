import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * searchAll's role scoping, against a fake client that records which table
 * or view each category is read from — the part that decides what a role
 * can find at all (build §2.7: a category a role may not see is never
 * queried, not filtered afterwards). Also: the literal text is escaped for
 * `ilike`, and every result carries its project id for the app.
 */

const h = vi.hoisted(() => ({
  reads: [] as string[],
  rows: {} as Record<string, unknown[]>,
  patterns: [] as string[],
  orFilters: [] as [string, string][],
  filters: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        ilike: (_col: string, pattern: string) => {
          h.reads.push(table);
          h.patterns.push(pattern);
          return chain;
        },
        is: () => chain,
        in: () => chain,
        neq: (col: string, value: unknown) => {
          h.filters.push([table, "neq", col, value]);
          return chain;
        },
        eq: (col: string, value: unknown) => {
          h.filters.push([table, "eq", col, value]);
          return chain;
        },
        // An ilike OR-filter is a search read (APX-64, ref numbers); any
        // other `or` is #101's preview scope on inventory.
        or: (expr: string) => {
          if (expr.includes(".ilike.")) {
            h.reads.push(table);
            h.orFilters.push([table, expr]);
          } else h.filters.push([table, "or", expr]);
          return chain;
        },
        limit: () => chain,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: h.rows[table] ?? [], error: null }),
      };
      return chain;
    },
  }),
}));

const { searchAll } = await import("./queries");

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  h.reads.length = 0;
  h.patterns.length = 0;
  h.orFilters.length = 0;
  h.filters.length = 0;
  h.rows = {};
});

describe("searchAll — what each role's search reads", () => {
  it("admin: every category, money tables included, and users", async () => {
    await searchAll(sessionAs("admin"), "tile");

    expect(h.reads.sort()).toEqual(
      [
        "approvals",
        "bills",
        "packages",
        "profiles",
        "projects",
        "stock_requests",
        "v_inventory_status",
      ].sort()
    );
  });

  it("site: the site views; never bills or users", async () => {
    await searchAll(sessionAs("site"), "tile");

    expect(h.reads.sort()).toEqual(
      ["approvals", "projects", "v_inventory_site", "v_package_site", "v_stock_request_site"].sort()
    );
  });

  it("client: the client views; never stock requests, inventory or users", async () => {
    await searchAll(sessionAs("client"), "tile");

    expect(h.reads.sort()).toEqual(["approvals", "projects", "v_bill_client", "v_package_client"].sort());
  });

  it("escapes ilike's wildcards so the text is matched literally", async () => {
    await searchAll(sessionAs("client"), "M_20 100%");

    expect(new Set(h.patterns)).toEqual(new Set(["%M\\_20 100\\%%"]));
  });

  it("gives every result its project id — the project's own, a package's or an approval's project", async () => {
    h.rows = {
      projects: [{ id: PROJECT_ID, name: "Tile House", location: "Hyderabad" }],
      v_package_client: [
        { id: "00000000-0000-4000-8000-0000000000e1", name: "Tiling", project_id: PROJECT_ID },
      ],
      approvals: [
        { id: "00000000-0000-4000-8000-0000000000a9", item: "Tile sample", project_id: PROJECT_ID },
      ],
    };

    const results = await searchAll(sessionAs("client"), "tile");

    expect(results.map((r) => [r.category, r.projectId])).toEqual([
      ["Projects", PROJECT_ID],
      ["Packages", PROJECT_ID],
      ["Approvals", PROJECT_ID],
    ]);
  });

  it("gives a user, and a central-store item, no project", async () => {
    h.rows = {
      profiles: [{ id: "00000000-0000-4000-8000-0000000000d2", full_name: "Tile Fitter", role: "site" }],
      v_inventory_status: [
        { id: "00000000-0000-4000-8000-000000000601", name: "Tile adhesive", project_id: null },
      ],
    };

    const results = await searchAll(sessionAs("admin"), "tile");

    expect(results.map((r) => [r.category, r.projectId])).toEqual([
      ["Inventory", null],
      ["Users", null],
    ]);
  });
});

describe("searchAll — Bills visibility", () => {
  it("never returns a draft bill to a client — the same filter as the client's Bills list", async () => {
    await searchAll(sessionAs("client"), "RA-");

    expect(h.reads).toContain("v_bill_client");
    expect(h.filters).toContainEqual(["v_bill_client", "neq", "status", "draft"]);
  });

  it("leaves the admin's bill search unfiltered by status, as before", async () => {
    await searchAll(sessionAs("admin"), "RA-");

    expect(h.reads).toContain("bills");
    expect(h.filters.filter((f) => f[0] === "bills")).toEqual([]);
  });

  it("still never reads bills for site", async () => {
    await searchAll(sessionAs("site"), "RA-");

    expect(h.reads).not.toContain("bills");
    expect(h.reads).not.toContain("v_bill_client");
  });
});

describe("searchAll — ref numbers (APX-64)", () => {
  it("matches a stock request by material OR ref number, for admin and site", async () => {
    await searchAll(sessionAs("admin"), "SR-BHEL");
    expect(h.orFilters).toContainEqual([
      "stock_requests",
      'material_name.ilike."%SR-BHEL%",ref_no.ilike."%SR-BHEL%"',
    ]);

    h.orFilters.length = 0;
    await searchAll(sessionAs("site"), "SR-BHEL");
    expect(h.orFilters).toContainEqual([
      "v_stock_request_site",
      'material_name.ilike."%SR-BHEL%",ref_no.ilike."%SR-BHEL%"',
    ]);
  });

  it("matches an approval by item OR ref number, for every role", async () => {
    for (const role of ["admin", "site", "client"] as const) {
      h.orFilters.length = 0;
      await searchAll(sessionAs(role), "AP-BHEL-NCH-007");
      expect(h.orFilters).toContainEqual([
        "approvals",
        'item.ilike."%AP-BHEL-NCH-007%",ref_no.ilike."%AP-BHEL-NCH-007%"',
      ]);
    }
  });

  it("still never reads stock requests for a client", async () => {
    await searchAll(sessionAs("client"), "SR-BHEL");
    expect(h.orFilters.map(([t]) => t)).not.toContain("stock_requests");
    expect(h.orFilters.map(([t]) => t)).not.toContain("v_stock_request_site");
  });

  it("shows the approval's ref number in its result line", async () => {
    h.rows = {
      approvals: [
        {
          id: "00000000-0000-4000-8000-0000000000a9",
          ref_no: "AP-BHEL-NCH-007",
          item: "Tile sample",
          project_id: PROJECT_ID,
        },
      ],
    };
    const [result] = await searchAll(sessionAs("client"), "AP-BHEL");
    expect(result?.sub.startsWith("AP-BHEL-NCH-007")).toBe(true);
  });
});

describe("searchAll — preview is scoped to the previewed project (APX-65)", () => {
  function previewing(role: "site" | "client"): Session {
    return { ...sessionAs("admin"), impersonating: { role, projectId: PROJECT_ID } };
  }

  it("client preview: every category it reads is narrowed to that project", async () => {
    await searchAll(previewing("client"), "tile");

    expect(h.filters).toContainEqual(["projects", "eq", "id", PROJECT_ID]);
    expect(h.filters).toContainEqual(["v_package_client", "eq", "project_id", PROJECT_ID]);
    expect(h.filters).toContainEqual(["approvals", "eq", "project_id", PROJECT_ID]);
    expect(h.filters).toContainEqual(["v_bill_client", "eq", "project_id", PROJECT_ID]);
    // Still the client's own views, and still nothing a client cannot see.
    expect(h.reads.sort()).toEqual(["approvals", "projects", "v_bill_client", "v_package_client"].sort());
  });

  it("site preview: stock and packages narrowed; inventory keeps the central store", async () => {
    await searchAll(previewing("site"), "tile");

    expect(h.filters).toContainEqual(["v_stock_request_site", "eq", "project_id", PROJECT_ID]);
    expect(h.filters).toContainEqual(["v_package_site", "eq", "project_id", PROJECT_ID]);
    expect(h.filters).toContainEqual([
      "v_inventory_site",
      "or",
      "project_id.eq." + PROJECT_ID + ",project_id.is.null",
    ]);
    expect(h.reads).not.toContain("profiles");
  });

  it("a preview project id that is not a UUID is never spliced into a filter string", async () => {
    const odd = { ...sessionAs("admin"), impersonating: { role: "site" as const, projectId: "x,id.neq.0" } };
    await searchAll(odd, "tile");

    expect(h.filters).toContainEqual(["v_inventory_site", "eq", "project_id", "x,id.neq.0"]);
    expect(h.filters.some((f) => f[1] === "or")).toBe(false);
  });

  it("no preview: no project filter at all, exactly as before", async () => {
    await searchAll(sessionAs("admin"), "tile");

    expect(h.filters.filter((f) => f[1] === "eq" || f[1] === "or")).toEqual([]);
  });
});
