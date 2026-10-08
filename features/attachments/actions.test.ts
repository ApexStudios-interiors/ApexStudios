import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * requestUploadUrl / confirmUpload end to end through next-safe-action, with
 * the session, the RLS-scoped client and R2 faked.
 *
 * What it pins down: a client is refused a daily update photo before any URL
 * is signed (other entity types unchanged), the existing count still refuses
 * a fifth up front, and the database's own refusals at confirm time —
 * trg_attachments_daily_update: someone else's update, the wrong project,
 * the four-photo cap — reach the caller as the domain errors they are,
 * with no thumbnail job enqueued. The trigger itself is tested against
 * Postgres in tests/integration/files-and-jobs.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {
    constructor(detail?: string) {
      super(detail ? `FORBIDDEN: ${detail}` : "FORBIDDEN");
    }
  }
  return {
    UnauthenticatedError,
    ForbiddenError,
    session: null as unknown as Session,
    requireProjectAccess: vi.fn(),
    liveCount: 0,
    insertResult: { data: { id: "att-1" }, error: null } as {
      data: { id: string } | null;
      error: { message: string; code?: string } | null;
    },
    /** confirmUpload's retry lookup: the row already recorded for that key. */
    lookupResult: { data: null, error: null } as { data: { id: string } | null; error: null },
    presignPut: vi.fn(async () => "https://r2.example/put"),
    headObject: vi.fn(),
    enqueue: vi.fn(async () => "job-1"),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => h.session,
  requireRole: async () => h.session,
  requireProjectAccess: h.requireProjectAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      // requestUploadUrl's count: select(…, { head: true }).eq.eq.is → awaited.
      // confirmUpload's insert: insert(…).select("id").single().
      // confirmUpload's retry lookup: select.eq….is(…).maybeSingle().
      const counted = {
        then: (resolve: (v: unknown) => unknown) => resolve({ count: h.liveCount, error: null }),
        maybeSingle: async () => h.lookupResult,
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => counted,
        insert: () => ({ select: () => ({ single: async () => h.insertResult }) }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/r2/presign", () => ({ presignPut: h.presignPut, presignGet: vi.fn() }));
vi.mock("@/lib/r2/head", () => ({ headObject: h.headObject }));
vi.mock("@/lib/jobs/enqueue", () => ({ enqueue: h.enqueue }));

const { requestUploadUrl, confirmUpload } = await import("./actions");

const ORG = "00000000-0000-4000-8000-0000000000a0";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const UPDATE_ID = "00000000-0000-4000-8000-0000000000b1";

function sessionAs(role: Session["role"]) {
  h.session = {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: ORG,
    role,
    fullName: "x",
    email: null,
    impersonating: null,
  };
}

const UPLOAD = {
  projectId: PROJECT_ID,
  entityType: "daily_update" as const,
  entityId: UPDATE_ID,
  fileName: "site.jpg",
  mimeType: "image/jpeg" as const,
  sizeBytes: 1000,
};

const KEY = `org/${ORG}/project/${PROJECT_ID}/daily_update/${UPDATE_ID}/abc-site.jpg`;

beforeEach(() => {
  sessionAs("site");
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.liveCount = 0;
  h.insertResult = { data: { id: "att-1" }, error: null };
  h.lookupResult = { data: null, error: null };
  h.presignPut.mockClear();
  h.headObject.mockReset();
  h.headObject.mockResolvedValue({ exists: true, sizeBytes: 1000 });
  h.enqueue.mockClear();
});

describe("requestUploadUrl", () => {
  it.each(["admin", "site"] as const)("signs a daily update photo upload for %s", async (role) => {
    sessionAs(role);

    const result = await requestUploadUrl(UPLOAD);

    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.url).toBe("https://r2.example/put");
    expect(h.presignPut).toHaveBeenCalledOnce();
  });

  it("refuses a client a daily update photo before anything is signed", async () => {
    sessionAs("client");

    const result = await requestUploadUrl(UPLOAD);

    expect(result?.serverError).toBe("You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.presignPut).not.toHaveBeenCalled();
  });

  it("leaves other entity types as they were: a client may still upload an approval photo", async () => {
    sessionAs("client");

    const result = await requestUploadUrl({ ...UPLOAD, entityType: "approval" });

    expect(result?.serverError).toBeUndefined();
    expect(h.presignPut).toHaveBeenCalledOnce();
  });

  it("still refuses a fifth photo up front, with the same message", async () => {
    h.liveCount = 4;

    const result = await requestUploadUrl(UPLOAD);

    expect(result?.serverError).toBe("Please give a reason.");
    expect(h.presignPut).not.toHaveBeenCalled();
  });
});

describe("confirmUpload", () => {
  const CONFIRM = { ...UPLOAD, key: KEY };

  it("answers a repeat confirm of the same upload with the row already recorded", async () => {
    h.insertResult = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "attachments_r2_key_key"',
      },
    };
    h.lookupResult = { data: { id: "att-1" }, error: null };

    const result = await confirmUpload(CONFIRM);

    expect(result?.data).toEqual({ id: "att-1" });
    // Its thumbnail job was enqueued by the first confirm.
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a repeat key that is not this user's upload for this record", async () => {
    h.insertResult = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "attachments_r2_key_key"',
      },
    };

    const result = await confirmUpload(CONFIRM);

    expect(result?.serverError).toBe("This request has already moved on. Refresh to see the current status.");
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a key signed for another record, before touching R2 or the database", async () => {
    const otherUpdate = "00000000-0000-4000-8000-0000000000b2";
    const result = await confirmUpload({
      ...CONFIRM,
      key: `org/${ORG}/project/${PROJECT_ID}/daily_update/${otherUpdate}/abc-site.jpg`,
    });

    expect(result?.serverError).toBe("You don't have permission to do that.");
    expect(h.headObject).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a key signed for another entity type", async () => {
    const result = await confirmUpload({
      ...CONFIRM,
      key: `org/${ORG}/project/${PROJECT_ID}/approval/${UPDATE_ID}/abc-site.jpg`,
    });

    expect(result?.serverError).toBe("You don't have permission to do that.");
    expect(h.headObject).not.toHaveBeenCalled();
  });

  it("records the photo and enqueues its thumbnail", async () => {
    const result = await confirmUpload(CONFIRM);

    expect(result?.data).toEqual({ id: "att-1" });
    expect(h.enqueue).toHaveBeenCalledExactlyOnceWith(
      "attachment.thumbnail",
      { attachmentId: "att-1" },
      { idempotencyKey: "att-1" }
    );
  });

  it.each([
    ["FORBIDDEN: only the author can add photos to a daily update", "You don't have permission to do that."],
    ["FORBIDDEN: those photos belong to another daily update", "You don't have permission to do that."],
    [
      "FORBIDDEN: only admin or site may add photos to a daily update",
      "You don't have permission to do that.",
    ],
    [`NOT_FOUND: daily update ${UPDATE_ID} does not exist in this project`, "That record no longer exists."],
    ["REASON_REQUIRED: this daily_update already has 4 attachments", "Please give a reason."],
  ])("reports the database's refusal %s and enqueues nothing", async (pgMessage, copy) => {
    h.insertResult = { data: null, error: { message: pgMessage } };

    const result = await confirmUpload(CONFIRM);

    expect(result?.data).toBeUndefined();
    expect(result?.serverError).toBe(copy);
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
