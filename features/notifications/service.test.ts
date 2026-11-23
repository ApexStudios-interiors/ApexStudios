import { describe, expect, it } from "vitest";
import {
  ACTION_KINDS,
  ACTION_LABEL,
  BELL_KINDS,
  INBOX_ONLY_KINDS,
  MATCH_NOTHING,
  ageInDays,
  ageLabel,
  audienceFilter,
  audienceRole,
  countUnread,
  isBellKind,
  isUnread,
  readKey,
  receiptsByKey,
  type AudienceSession,
} from "./service";
import { markNotificationReadSchema } from "./schema";

const USER = "00000000-0000-4000-8000-0000000000d5";
const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const session = (role: AudienceSession["role"]): AudienceSession => ({
  userId: USER,
  role,
  impersonating: null,
});

describe("kinds (D68)", () => {
  it("keeps the four original bell kinds, in the bell", () => {
    for (const k of ["stock_request", "bill_submitted", "approval_pending", "inventory_low"]) {
      expect(isBellKind(k)).toBe(true);
    }
  });

  it("adds the status-change kinds to the bell (APX-18, APX-62)", () => {
    for (const k of [
      "stock_approved",
      "stock_ordered",
      "stock_delivered",
      "stock_rejected",
      "approval_approved",
      "approval_rejected",
      "bill_certified",
      "bill_rejected",
    ]) {
      expect(isBellKind(k)).toBe(true);
    }
  });

  it("keeps inbox-only state out of the bell", () => {
    for (const k of INBOX_ONLY_KINDS) expect(isBellKind(k)).toBe(false);
    expect(BELL_KINDS.some((k) => (INBOX_ONLY_KINDS as readonly string[]).includes(k))).toBe(false);
  });

  it("labels every kind", () => {
    for (const k of [...BELL_KINDS, ...INBOX_ONLY_KINDS]) expect(ACTION_LABEL[k]).toMatch(/\S/);
  });

  it("lets only bell kinds be marked read", () => {
    const id = "00000000-0000-4000-8000-000000000214";
    expect(markNotificationReadSchema.safeParse({ kind: "stock_approved", entityId: id }).success).toBe(true);
    expect(markNotificationReadSchema.safeParse({ kind: "bill_rejected", entityId: id }).success).toBe(true);
    expect(markNotificationReadSchema.safeParse({ kind: "bill_draft", entityId: id }).success).toBe(false);
    expect(markNotificationReadSchema.safeParse({ kind: "anything", entityId: id }).success).toBe(false);
  });
});

describe("ACTION_KINDS — what is waiting on each role (APX-72)", () => {
  it("admin: pending requests, draft and certified-unpaid bills, rejected approvals to revise", () => {
    expect([...ACTION_KINDS.admin].sort()).toEqual(
      ["approval_revision", "bill_draft", "bill_unpaid", "stock_request"].sort()
    );
  });

  it("site: ordered deliveries and rejected requests — and never a bill", () => {
    expect([...ACTION_KINDS.site].sort()).toEqual(["delivery_due", "stock_rejected"]);
    expect(ACTION_KINDS.site.some((k) => k.startsWith("bill_"))).toBe(false);
  });

  it("client: pending approvals and submitted bills — and never stock or inventory", () => {
    expect([...ACTION_KINDS.client].sort()).toEqual(["approval_pending", "bill_submitted"]);
    expect(
      ACTION_KINDS.client.some(
        (k) => k.startsWith("stock_") || k.startsWith("inventory") || k === "delivery_due"
      )
    ).toBe(false);
  });
});

describe("audienceFilter", () => {
  it("normally: the role's rows or rows naming this person", () => {
    expect(audienceFilter(session("site"))).toBe(`for_roles.cs.{site},for_profile_id.eq.${USER}`);
    expect(audienceFilter(session("client"))).toBe(`for_roles.cs.{client},for_profile_id.eq.${USER}`);
  });

  it("previewing: the previewed role on the previewed project, plus the central store (APX-65)", () => {
    const filter = audienceFilter({
      ...session("admin"),
      impersonating: { role: "client", projectId: PROJECT },
    });
    expect(filter).toBe(
      [
        `and(project_id.eq.${PROJECT},for_roles.cs.{client})`,
        `and(project_id.eq.${PROJECT},for_profile_role.eq.client)`,
        `and(project_id.is.null,for_roles.cs.{client})`,
      ].join(",")
    );
    // Never the admin's own named rows while previewing.
    expect(filter).not.toContain(USER);
  });

  it("fails closed rather than splice an unexpected value into the filter", () => {
    expect(audienceFilter({ ...session("site"), userId: "x,for_roles.cs.{admin}" })).toBe(MATCH_NOTHING);
    expect(
      audienceFilter({ ...session("admin"), impersonating: { role: "site", projectId: "not-a-uuid" } })
    ).toBe(MATCH_NOTHING);
  });

  it("uses the previewed role's rules while previewing", () => {
    expect(audienceRole(session("admin"))).toBe("admin");
    expect(audienceRole({ ...session("admin"), impersonating: { role: "site", projectId: PROJECT } })).toBe(
      "site"
    );
  });
});

describe("ageInDays / ageLabel", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");

  it("floors to whole days", () => {
    expect(ageInDays("2026-11-24T08:00:00Z", now)).toBe(0);
    expect(ageInDays("2026-11-23T12:00:00Z", now)).toBe(1);
    expect(ageInDays("2026-11-23T12:00:01Z", now)).toBe(0);
    expect(ageInDays("2026-11-10T12:00:00Z", now)).toBe(14);
  });

  it("is never negative and survives a bad timestamp", () => {
    expect(ageInDays("2026-11-25T00:00:00Z", now)).toBe(0);
    expect(ageInDays("not a date", now)).toBe(0);
  });

  it("reads naturally", () => {
    expect(ageLabel(0)).toBe("Today");
    expect(ageLabel(1)).toBe("1 day");
    expect(ageLabel(12)).toBe("12 days");
  });
});

const item = (kind: string, entityId: string, createdAt: string) => ({ kind, entityId, createdAt });

describe("isUnread", () => {
  it("is unread when there is no receipt", () => {
    expect(isUnread(item("stock_request", "a", "2026-09-28T10:00:00Z"), new Map())).toBe(true);
  });

  it("is read once a receipt is newer than the notification", () => {
    const reads = receiptsByKey([{ kind: "stock_request", entityId: "a", readAt: "2026-09-28T11:00:00Z" }]);
    expect(isUnread(item("stock_request", "a", "2026-09-28T10:00:00Z"), reads)).toBe(false);
  });

  it("counts an equal timestamp as read", () => {
    // The receipt is written at or after render, so identical timestamps can
    // only be the same occurrence.
    const reads = receiptsByKey([{ kind: "bill_submitted", entityId: "b", readAt: "2026-09-28T10:00:00Z" }]);
    expect(isUnread(item("bill_submitted", "b", "2026-09-28T10:00:00Z"), reads)).toBe(false);
  });

  it("becomes unread again when the work is raised after the receipt", () => {
    // The point of storing a timestamp rather than a boolean: an inventory
    // item that drops below its reorder level a second time must be told
    // about again, not silenced by a receipt from the first time.
    const reads = receiptsByKey([{ kind: "inventory_low", entityId: "c", readAt: "2026-09-28T10:00:00Z" }]);
    expect(isUnread(item("inventory_low", "c", "2026-09-28T12:00:00Z"), reads)).toBe(true);
  });

  it("does not let one entity's receipt silence another of the same kind", () => {
    const reads = receiptsByKey([{ kind: "stock_request", entityId: "a", readAt: "2026-09-28T11:00:00Z" }]);
    expect(isUnread(item("stock_request", "z", "2026-09-28T10:00:00Z"), reads)).toBe(true);
  });

  it("does not let one kind's receipt silence the same id of another kind", () => {
    // entity_id is only unique within a kind — the view unions four unrelated
    // tables, so the key must carry both.
    const reads = receiptsByKey([
      { kind: "stock_request", entityId: "shared", readAt: "2026-09-28T11:00:00Z" },
    ]);
    expect(isUnread(item("approval_pending", "shared", "2026-09-28T10:00:00Z"), reads)).toBe(true);
  });
});

describe("countUnread", () => {
  it("counts only the unread ones", () => {
    const reads = receiptsByKey([
      { kind: "stock_request", entityId: "a", readAt: "2026-09-28T11:00:00Z" },
      { kind: "bill_submitted", entityId: "b", readAt: "2026-09-28T11:00:00Z" },
    ]);
    const items = [
      item("stock_request", "a", "2026-09-28T10:00:00Z"), // read
      item("bill_submitted", "b", "2026-09-28T10:00:00Z"), // read
      item("approval_pending", "c", "2026-09-28T10:00:00Z"), // never opened
    ];
    expect(countUnread(items, reads)).toBe(1);
  });

  it("is zero for an empty list", () => {
    expect(countUnread([], new Map())).toBe(0);
  });

  it("is the full length when nothing has been read — the pre-D60 behaviour", () => {
    const items = [
      item("stock_request", "a", "2026-09-28T10:00:00Z"),
      item("bill_submitted", "b", "2026-09-28T10:00:00Z"),
    ];
    expect(countUnread(items, new Map())).toBe(2);
  });
});

describe("readKey", () => {
  it("separates kind from id so the two cannot run together", () => {
    expect(readKey("stock_request", "a")).not.toBe(readKey("stock", "request:a"));
  });
});
