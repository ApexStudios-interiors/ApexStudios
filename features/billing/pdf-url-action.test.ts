import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getBillPdfUrl — the web dialog's and the mobile detail's PDF link — with
 * the selection (getCurrentBillPdfKey, tested in ./pdf-selection.test.ts)
 * mocked: BILLING_ENABLED and a session first, the session handed to the
 * selection, the chosen key presigned as a download, null when there is none.
 */

const h = vi.hoisted(() => ({
  env: { BILLING_ENABLED: true },
  session: { userId: "u", role: "client" } as unknown,
  requireSession: vi.fn(),
  getCurrentBillPdfKey: vi.fn(),
  presignGet: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/auth/session", () => ({ requireSession: h.requireSession, requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/jobs/enqueue", () => ({ enqueue: vi.fn() }));
vi.mock("@/lib/r2/presign", () => ({ presignGet: h.presignGet }));
vi.mock("./queries", () => ({ getCurrentBillPdfKey: h.getCurrentBillPdfKey }));

const { getBillPdfUrl } = await import("./actions");

const BILL_ID = "00000000-0000-4000-8000-0000000000e1";

beforeEach(() => {
  h.env.BILLING_ENABLED = true;
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(h.session);
  h.getCurrentBillPdfKey.mockReset();
  h.presignGet.mockReset();
  h.presignGet.mockResolvedValue("https://signed/url");
});

describe("getBillPdfUrl", () => {
  it("presigns the selected invoice PDF as a download", async () => {
    h.getCurrentBillPdfKey.mockResolvedValue("org/o/project/p/bill/b/uuid-RA-APX-001.pdf");

    expect(await getBillPdfUrl(BILL_ID)).toBe("https://signed/url");
    expect(h.getCurrentBillPdfKey).toHaveBeenCalledExactlyOnceWith(h.session, BILL_ID);
    expect(h.presignGet).toHaveBeenCalledExactlyOnceWith(
      "org/o/project/p/bill/b/uuid-RA-APX-001.pdf",
      "attachment"
    );
  });

  it("returns null, signing nothing, when there is no invoice PDF for the current revision", async () => {
    h.getCurrentBillPdfKey.mockResolvedValue(null);

    expect(await getBillPdfUrl(BILL_ID)).toBeNull();
    expect(h.presignGet).not.toHaveBeenCalled();
  });

  it("refuses while BILLING_ENABLED is off, before any read", async () => {
    h.env.BILLING_ENABLED = false;

    await expect(getBillPdfUrl(BILL_ID)).rejects.toThrow(/^FORBIDDEN/);
    expect(h.getCurrentBillPdfKey).not.toHaveBeenCalled();
  });

  it("needs a session, before any read", async () => {
    h.requireSession.mockRejectedValue(new Error("UNAUTHENTICATED"));

    await expect(getBillPdfUrl(BILL_ID)).rejects.toThrow("UNAUTHENTICATED");
    expect(h.getCurrentBillPdfKey).not.toHaveBeenCalled();
  });
});
