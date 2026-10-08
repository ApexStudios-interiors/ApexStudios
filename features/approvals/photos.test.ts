import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * approvalForPhotos — the "exists for this session and still pending" check
 * shared by the web's addSamplePhotos and the mobile photo routes — with the
 * RLS-scoped client faked. The attachments freeze it mirrors is tested
 * against Postgres in tests/integration/approvals.test.ts.
 */

const h = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as { message: string } | null },
  calls: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      h.calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => (h.calls.push(["select", ...a]), chain),
        eq: (...a: unknown[]) => (h.calls.push(["eq", ...a]), chain),
        is: (...a: unknown[]) => (h.calls.push(["is", ...a]), chain),
        maybeSingle: async () => h.result,
      };
      return chain;
    },
  }),
}));

const { approvalForPhotos } = await import("./photos");

const APPROVAL_ID = "00000000-0000-4000-8000-0000000000a9";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  h.calls.length = 0;
  h.result = { data: { id: APPROVAL_ID, project_id: PROJECT_ID, status: "pending" }, error: null };
});

describe("approvalForPhotos", () => {
  it("returns a pending approval's id, project and status", async () => {
    await expect(approvalForPhotos(APPROVAL_ID)).resolves.toEqual({
      id: APPROVAL_ID,
      projectId: PROJECT_ID,
      status: "pending",
    });
    expect(h.calls).toEqual([
      ["from", "approvals"],
      ["select", "id, project_id, status"],
      ["eq", "id", APPROVAL_ID],
      ["is", "deleted_at", null],
    ]);
  });

  it("refuses an approval this session cannot see (or that does not exist) with NOT_FOUND", async () => {
    h.result = { data: null, error: null };

    await expect(approvalForPhotos(APPROVAL_ID)).rejects.toThrow("NOT_FOUND: this approval no longer exists");
  });

  it.each(["approved", "rejected"])("refuses a %s approval with ILLEGAL_TRANSITION", async (status) => {
    h.result = { data: { id: APPROVAL_ID, project_id: PROJECT_ID, status }, error: null };

    await expect(approvalForPhotos(APPROVAL_ID)).rejects.toThrow(
      "ILLEGAL_TRANSITION: photos can only be added to a pending approval"
    );
  });

  it("throws a database error unchanged", async () => {
    h.result = { data: null, error: { message: "approvals lookup failed" } };

    await expect(approvalForPhotos(APPROVAL_ID)).rejects.toThrow("approvals lookup failed");
  });
});
