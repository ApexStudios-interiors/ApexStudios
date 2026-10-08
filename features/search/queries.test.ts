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
        in: () => chain,
        neq: (col: string, value: unknown) => {
          h.filters.push([table, "neq", col, value]);
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
