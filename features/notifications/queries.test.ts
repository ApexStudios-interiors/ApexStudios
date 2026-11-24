import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import { BELL_KINDS } from "./service";

/**
 * getNotifications / getActionItems against a fake RLS-scoped client that
 * records every filter. What it pins down (D72): the bell reads only bell
 * kinds, both read through the same audience rule (role OR named recipient,
 * or the previewed role on the previewed project — APX-65), the inbox reads
 * only the role's action kinds oldest first, one page at a time, and every
 * row carries its age and a canonical link.
 */

type Call = [string, ...unknown[]];

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: (_cols: string, opts?: unknown) => {
          h.calls.push([table, "select", opts ?? null]);
          return chain;
        },
        in: (col: string, values: unknown[]) => {
          h.calls.push([table, "in", col, values]);
          return chain;
        },
        or: (expr: string) => {
          h.calls.push([table, "or", expr]);
          return chain;
        },
        eq: (col: string, value: unknown) => {
          h.calls.push([table, "eq", col, value]);
          return chain;
        },
        order: (col: string, opts: { ascending: boolean }) => {
          h.calls.push([table, "order", col, opts.ascending]);
          return chain;
        },
        range: (from: number, to: number) => {
          h.calls.push([table, "range", from, to]);
          return chain;
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: h.rows[table] ?? [], count: h.counts[table] ?? null, error: null }),
      };
      return chain;
    },
  }),
}));

const { getActionItems, getNotifications } = await import("./queries");

const USER = "00000000-0000-4000-8000-0000000000d5";
const PROJECT = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"], impersonating: Session["impersonating"] = null): Session {
  return {
    userId: USER,
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating,
  };
}

const callsOn = (table: string, op: string) => h.calls.filter((c) => c[0] === table && c[1] === op);

beforeEach(() => {
  h.calls.length = 0;
  h.rows = {};
  h.counts = {};
});

describe("getNotifications — the bell", () => {
  it("reads only bell kinds, through the audience rule", async () => {
    await getNotifications(sessionAs("site"));

    expect(callsOn("v_notifications", "in")).toEqual([["v_notifications", "in", "kind", [...BELL_KINDS]]]);
    expect(callsOn("v_notifications", "or")).toEqual([
      ["v_notifications", "or", `for_roles.cs.{site},for_profile_id.eq.${USER}`],
    ]);
  });

  it("while previewing, is scoped to the previewed project and role (APX-65)", async () => {
    await getNotifications(sessionAs("admin", { role: "client", projectId: PROJECT }));

    const expr = String(callsOn("v_notifications", "or")[0]?.[2]);
    expect(expr).toContain(`project_id.eq.${PROJECT}`);
    expect(expr).toContain("for_roles.cs.{client}");
    expect(expr).not.toContain("{admin}");
  });

  it("keeps the existing DTO shape for an existing kind", async () => {
    h.rows = {
      v_notifications: [
        {
          kind: "stock_request",
          entity_id: "00000000-0000-4000-8000-000000000214",
          project_id: PROJECT,
          title: "Pending stock request: Tile",
          href: `/projects/${PROJECT}/stock`,
          created_at: "2026-11-20T09:00:00Z",
        },
      ],
      projects: [{ id: PROJECT, name: "BHEL Nagar", code: "bhel-nch" }],
    };

    const [n] = await getNotifications(sessionAs("site"));

    expect(n).toEqual({
      kind: "stock_request",
      entityId: "00000000-0000-4000-8000-000000000214",
      projectId: PROJECT,
      projectName: "BHEL Nagar",
      title: "Pending stock request: Tile",
      href: "/projects/bhel-nch/stock",
      createdAt: "2026-11-20T09:00:00Z",
      unread: true,
    });
  });
});

describe("getActionItems — Needs my action (APX-72)", () => {
  it.each([
    ["admin", ["stock_request", "bill_draft", "bill_unpaid", "approval_revision"]],
    ["site", ["delivery_due", "stock_rejected"]],
    ["client", ["approval_pending", "bill_submitted"]],
  ] as const)("%s reads only its own action kinds", async (role, kinds) => {
    await getActionItems(sessionAs(role), { page: 1, pageSize: 10 });

    expect(callsOn("v_notifications", "in")).toEqual([["v_notifications", "in", "kind", [...kinds]]]);
  });

  it("uses the previewed role's action kinds while previewing", async () => {
    await getActionItems(sessionAs("admin", { role: "site", projectId: PROJECT }), { page: 1, pageSize: 10 });

    expect(callsOn("v_notifications", "in")).toEqual([
      ["v_notifications", "in", "kind", ["delivery_due", "stock_rejected"]],
    ]);
  });

  it("is oldest first, paginated with an exact count", async () => {
    await getActionItems(sessionAs("client"), { page: 2, pageSize: 10 });

    expect(callsOn("v_notifications", "select")).toEqual([["v_notifications", "select", { count: "exact" }]]);
    expect(callsOn("v_notifications", "order")[0]).toEqual(["v_notifications", "order", "created_at", true]);
    expect(callsOn("v_notifications", "range")).toEqual([["v_notifications", "range", 10, 19]]);
  });

  it("maps each row with its action, age and canonical link", async () => {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    h.rows = {
      v_notifications: [
        {
          kind: "bill_submitted",
          entity_id: "00000000-0000-4000-8000-000000000402",
          project_id: PROJECT,
          title: "Bill RA-03 awaiting certification",
          href: `/projects/${PROJECT}/billing`,
          created_at: since,
        },
      ],
      projects: [{ id: PROJECT, name: "BHEL Nagar", code: "bhel-nch" }],
    };
    h.counts = { v_notifications: 1 };

    const page = await getActionItems(sessionAs("client"), { page: 1, pageSize: 10 });

    expect(page.total).toBe(1);
    expect(page.rows).toEqual([
      {
        kind: "bill_submitted",
        action: "Certify bill",
        entityId: "00000000-0000-4000-8000-000000000402",
        projectId: PROJECT,
        projectName: "BHEL Nagar",
        title: "Bill RA-03 awaiting certification",
        href: "/projects/bhel-nch/billing",
        since,
        ageDays: 3,
      },
    ]);
  });

  it("is an empty first page when nothing is waiting", async () => {
    h.counts = { v_notifications: 0 };
    const page = await getActionItems(sessionAs("site"), { page: 1, pageSize: 10 });
    expect(page).toEqual({ rows: [], total: 0, page: 1, pageSize: 10 });
  });
});
