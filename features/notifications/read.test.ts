import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * markNotificationReadFor — the shared write for the web bell and the mobile
 * API — with the RLS-scoped client faked. What it pins down: the row written
 * is always the SESSION user's (never anyone named in the input), a second
 * open is an upsert on the same key that refreshes `read_at`, and a database
 * error is thrown unchanged. The own-rows-only RLS behind it is the
 * notification_reads policies (migration 20260928090001).
 */

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  table: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      h.table = table;
      return { upsert: h.upsert };
    },
  }),
}));

const { markNotificationReadFor } = await import("./read");

const ENTITY_ID = "00000000-0000-4000-8000-0000000000a9";

function sessionAs(userId: string): Session {
  return {
    userId,
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role: "client",
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

beforeEach(() => {
  h.upsert.mockReset();
  h.upsert.mockResolvedValue({ error: null });
  h.table = "";
});

describe("markNotificationReadFor", () => {
  it("upserts the session user's own read row for that notification", async () => {
    await markNotificationReadFor(sessionAs("00000000-0000-4000-8000-0000000000d6"), {
      kind: "approval_pending",
      entityId: ENTITY_ID,
    });

    expect(h.table).toBe("notification_reads");
    expect(h.upsert).toHaveBeenCalledExactlyOnceWith(
      {
        profile_id: "00000000-0000-4000-8000-0000000000d6",
        kind: "approval_pending",
        entity_id: ENTITY_ID,
        read_at: expect.any(String),
      },
      { onConflict: "profile_id,kind,entity_id" }
    );
  });

  it("never writes a row for anyone but the session user, whatever the input carries", async () => {
    const input = {
      kind: "stock_request",
      entityId: ENTITY_ID,
      profileId: "00000000-0000-4000-8000-0000000000d2",
    };

    await markNotificationReadFor(
      sessionAs("00000000-0000-4000-8000-0000000000d5"),
      input as unknown as Parameters<typeof markNotificationReadFor>[1]
    );

    expect(h.upsert.mock.calls[0]?.[0]).toMatchObject({ profile_id: "00000000-0000-4000-8000-0000000000d5" });
    expect(h.upsert.mock.calls[0]?.[0]).not.toHaveProperty("profileId");
  });

  it("is safe to repeat: a second open is the same upsert, with a fresh read_at", async () => {
    const session = sessionAs("00000000-0000-4000-8000-0000000000d6");
    const input = { kind: "approval_pending" as const, entityId: ENTITY_ID };

    await markNotificationReadFor(session, input);
    await markNotificationReadFor(session, input);

    expect(h.upsert).toHaveBeenCalledTimes(2);
    expect(h.upsert.mock.calls[1]?.[1]).toEqual({ onConflict: "profile_id,kind,entity_id" });
    expect(new Date(h.upsert.mock.calls[1]?.[0].read_at).getTime()).not.toBeNaN();
  });

  it("throws a database error unchanged — e.g. RLS refusing a row that is not the caller's", async () => {
    const rls = 'new row violates row-level security policy for table "notification_reads"';
    h.upsert.mockResolvedValue({ error: { message: rls } });

    await expect(
      markNotificationReadFor(sessionAs("00000000-0000-4000-8000-0000000000d6"), {
        kind: "inventory_low",
        entityId: ENTITY_ID,
      })
    ).rejects.toThrow(rls);
  });
});
