import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { RequestApprovalInput } from "./schema";

/**
 * requestApprovalFor — the shared create path for the web action and the
 * mobile API — with the RLS-scoped client faked. What it pins down: the
 * validated input reaches rpc_create_approval argument for argument, sample
 * photos are re-checked as this session's own uploads for this project and
 * approval before anything is created, only `{ id, refNo, projectId, status }`
 * comes back, the RPC's own errors (supersession's included) are thrown
 * unchanged, and nothing here refreshes the web cache. rpc_create_approval
 * itself is tested against Postgres in tests/integration/approvals.test.ts.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  attachments: { data: [] as { id: string }[] | null, error: null as { message: string } | null },
  attachmentCalls: [] as unknown[][],
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: h.updateTag, revalidatePath: h.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: h.rpc,
    from: () => {
      const chain = {
        select: (...a: unknown[]) => (h.attachmentCalls.push(["select", ...a]), chain),
        in: (...a: unknown[]) => (h.attachmentCalls.push(["in", ...a]), chain),
        eq: (...a: unknown[]) => (h.attachmentCalls.push(["eq", ...a]), chain),
        is: async (...a: unknown[]) => (h.attachmentCalls.push(["is", ...a]), h.attachments),
      };
      return chain;
    },
  }),
}));

const { requestApprovalFor } = await import("./create");

const APPROVAL_ID = "00000000-0000-4000-8000-0000000000a9";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const PHASE_ID = "00000000-0000-4000-8000-0000000000f1";
const REJECTED_ID = "00000000-0000-4000-8000-0000000000a8";
const PHOTO = "00000000-0000-4000-8000-000000000a01";

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

const INPUT: RequestApprovalInput = {
  id: APPROVAL_ID,
  projectId: PROJECT_ID,
  packageId: PACKAGE_ID,
  phaseId: PHASE_ID,
  type: "material_sample",
  item: "Pool tile 300x300",
  note: "Two shades",
  neededBy: "2026-10-20",
  attachmentIds: [],
  supersedesId: undefined,
};

/** The full row the RPC returns — more than any caller should see. */
const ROW = {
  id: APPROVAL_ID,
  org_id: "00000000-0000-4000-8000-0000000000a0",
  project_id: PROJECT_ID,
  ref_no: "AP-BHEL-NCH-007",
  status: "pending",
  requested_by: "00000000-0000-4000-8000-0000000000d5",
  decided_by: null,
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: ROW, error: null });
  h.attachments = { data: [], error: null };
  h.attachmentCalls.length = 0;
  h.updateTag.mockClear();
  h.revalidatePath.mockClear();
});

describe("requestApprovalFor", () => {
  it.each(["admin", "site"] as const)(
    "creates the approval for %s and returns { id, refNo, projectId, status }",
    async (role) => {
      const result = await requestApprovalFor(sessionAs(role), INPUT);

      expect(result).toEqual({
        id: APPROVAL_ID,
        refNo: "AP-BHEL-NCH-007",
        projectId: PROJECT_ID,
        status: "pending",
      });
    }
  );

  it("passes every input to the RPC argument for argument", async () => {
    await requestApprovalFor(sessionAs("site"), { ...INPUT, supersedesId: REJECTED_ID });

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_create_approval", {
      p_id: APPROVAL_ID,
      p_project_id: PROJECT_ID,
      p_package_id: PACKAGE_ID,
      p_type: "material_sample",
      p_item: "Pool tile 300x300",
      p_phase_id: PHASE_ID,
      p_note: "Two shades",
      p_needed_by: "2026-10-20",
      p_supersedes_id: REJECTED_ID,
    });
  });

  it("returns no other column of the row", async () => {
    const result = await requestApprovalFor(sessionAs("admin"), INPUT);

    expect(Object.keys(result).sort()).toEqual(["id", "projectId", "refNo", "status"]);
  });

  it("does not look at attachments when there are none", async () => {
    await requestApprovalFor(sessionAs("site"), INPUT);

    expect(h.attachmentCalls).toHaveLength(0);
  });

  it("re-checks sample photos as this session's own uploads for this project and approval", async () => {
    h.attachments = { data: [{ id: PHOTO }], error: null };

    await requestApprovalFor(sessionAs("site"), { ...INPUT, attachmentIds: [PHOTO] });

    expect(h.attachmentCalls).toEqual([
      ["select", "id"],
      ["in", "id", [PHOTO]],
      ["eq", "entity_type", "approval"],
      ["eq", "entity_id", APPROVAL_ID],
      ["eq", "project_id", PROJECT_ID],
      ["eq", "uploaded_by", "00000000-0000-4000-8000-0000000000d5"],
      ["is", "deleted_at", null],
    ]);
    expect(h.rpc).toHaveBeenCalledOnce();
  });

  it("refuses, before creating anything, when a photo is not one of those uploads", async () => {
    h.attachments = { data: [], error: null };

    await expect(requestApprovalFor(sessionAs("site"), { ...INPUT, attachmentIds: [PHOTO] })).rejects.toThrow(
      "NOT_FOUND: one or more photos did not upload correctly — please retry them"
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    `NOT_FOUND: superseded approval ${REJECTED_ID} does not exist in this project`,
    "ILLEGAL_TRANSITION: only a rejected approval can be superseded",
    `ILLEGAL_TRANSITION: approval ${REJECTED_ID} has already been superseded`,
    `FORBIDDEN: not a member of project ${PROJECT_ID}`,
    "FORBIDDEN: requires admin or site",
    "REASON_REQUIRED: item is required",
    `NOT_FOUND: package ${PACKAGE_ID} does not exist in this project`,
  ])("throws the RPC's error unchanged: %s", async (message) => {
    h.rpc.mockResolvedValue({ data: null, error: { message } });

    await expect(
      requestApprovalFor(sessionAs("site"), { ...INPUT, supersedesId: REJECTED_ID })
    ).rejects.toThrow(message);
  });

  it("answers a retry of an approval that already exists (its id meets approvals_pkey) as ILLEGAL_TRANSITION, never a second approval", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "approvals_pkey"',
      },
    });

    await expect(requestApprovalFor(sessionAs("site"), INPUT)).rejects.toThrow(
      "ILLEGAL_TRANSITION: this approval has already been requested"
    );
    // The id sent is the caller's own, unchanged — what makes the retry collide.
    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({ p_id: APPROVAL_ID });
  });

  it("passes any OTHER unique violation through unchanged (not mistaken for a retry)", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "approvals_ref_no_uq"',
      },
    });

    await expect(requestApprovalFor(sessionAs("site"), INPUT)).rejects.toThrow(/approvals_ref_no_uq/);
  });

  it("does not refresh the web cache — that is the web action's job", async () => {
    await requestApprovalFor(sessionAs("admin"), INPUT);

    expect(h.updateTag).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
