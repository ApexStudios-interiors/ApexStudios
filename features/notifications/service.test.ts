import { describe, expect, it } from "vitest";
import { countUnread, isUnread, readKey, receiptsByKey } from "./service";

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
