import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * APX-52: one failing shell read must not take down every page. Each read is
 * settled independently; a failure renders the shell without that piece and
 * is logged.
 */

const h = vi.hoisted(() => ({
  bell: vi.fn(),
  portfolio: vi.fn(),
  navLists: vi.fn(),
  requests: vi.fn(),
  approvals: vi.fn(),
  bills: vi.fn(),
  backup: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/notifications/queries", () => ({ getBellNotifications: h.bell }));
vi.mock("@/features/projects/queries", () => ({ getPortfolio: h.portfolio }));
vi.mock("@/features/packages/queries", () => ({ getPackageNavLists: h.navLists }));
vi.mock("@/features/stock/queries", () => ({ countPendingRequestsByProject: h.requests }));
vi.mock("@/features/approvals/queries", () => ({ countPendingApprovalsByProject: h.approvals }));
vi.mock("@/features/billing/queries", () => ({ countSubmittedBillsByProject: h.bills }));
vi.mock("@/features/ops/queries", () => ({ getBackupAlert: h.backup }));

const { loadShellData, valueOr } = await import("./shell-data");

function session(role: Session["role"], impersonating: Session["impersonating"] = null): Session {
  return { userId: "u", orgId: "o", role, fullName: "x", email: null, impersonating };
}

const NOTIFICATION = {
  kind: "stock_request" as const,
  entityId: "e1",
  projectId: "p1",
  projectName: "Club House",
  title: "Pending stock request: cement",
  href: "/projects/club/stock",
  createdAt: "2026-11-24T10:00:00Z",
  unread: true,
};

beforeEach(() => {
  h.bell.mockReset().mockResolvedValue({ items: [NOTIFICATION], unreadCount: 7 });
  h.portfolio.mockReset().mockResolvedValue({
    role: "money",
    stats: {},
    projects: [{ id: "p1", code: "CLUB", name: "Club House" }],
  });
  h.navLists.mockReset().mockResolvedValue({ p1: [{ id: "k1", name: "Pool", seqNo: 1 }] });
  h.requests.mockReset().mockResolvedValue({ p1: 3 });
  h.approvals.mockReset().mockResolvedValue({ p1: 2 });
  h.bills.mockReset().mockResolvedValue({ p1: 1 });
  h.backup.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadShellData", () => {
  it("assembles the bell, the sidebar projects and their badges", async () => {
    const data = await loadShellData(session("admin"));
    expect(data.notifications).toEqual([NOTIFICATION]);
    expect(data.unreadCount).toBe(7);
    expect(data.projects).toEqual([
      {
        id: "p1",
        code: "CLUB",
        name: "Club House",
        packages: [{ id: "k1", name: "Pool", seqNo: 1 }],
        pendingRequests: 3,
        pendingApprovals: 0,
        submittedBills: 0,
      },
    ]);
  });

  it("a failing notifications query renders the shell without the bell, and logs it", async () => {
    h.bell.mockRejectedValue(new Error("v_notifications timed out"));
    const data = await loadShellData(session("admin"));
    expect(data.notifications).toEqual([]);
    expect(data.unreadCount).toBe(0);
    expect(data.projects).toHaveLength(1); // the rest of the shell is intact
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("notifications failed"),
      expect.any(Error)
    );
  });

  it("a failing badge count drops only that badge", async () => {
    h.requests.mockRejectedValue(new Error("boom"));
    const data = await loadShellData(session("site"));
    expect(data.projects[0]?.pendingRequests).toBe(0);
    expect(data.projects[0]?.packages).toHaveLength(1);
  });

  it("a failing portfolio leaves an empty sidebar rather than an error page", async () => {
    h.portfolio.mockRejectedValue(new Error("projects down"));
    const data = await loadShellData(session("admin"));
    expect(data.projects).toEqual([]);
    expect(data.notifications).toHaveLength(1);
  });

  it("shows the client's badges, not stock, for a client", async () => {
    const data = await loadShellData(session("client"));
    expect(h.requests).not.toHaveBeenCalled();
    expect(data.projects[0]).toMatchObject({ pendingRequests: 0, pendingApprovals: 2, submittedBills: 1 });
  });

  it("reads the backup alert for an admin only, and not while previewing another role", async () => {
    h.backup.mockResolvedValue({ name: "backup.verify", lastError: "BACKUP_TOO_SMALL", finishedAt: null });
    expect((await loadShellData(session("admin"))).backupAlert).toMatchObject({ name: "backup.verify" });

    h.backup.mockClear();
    await loadShellData(session("site"));
    await loadShellData(session("admin", { role: "client", projectId: "p1" }));
    expect(h.backup).not.toHaveBeenCalled();
  });

  it("a failing backup-status read hides the banner rather than the page", async () => {
    h.backup.mockRejectedValue(new Error("jobs unreadable"));
    const data = await loadShellData(session("admin"));
    expect(data.backupAlert).toBeNull();
  });
});

describe("valueOr", () => {
  it("passes a fulfilled value through without logging", () => {
    expect(valueOr({ status: "fulfilled", value: 1 }, 0, "x")).toBe(1);
    expect(console.error).not.toHaveBeenCalled();
  });
});
