/**
 * The one rule that decides whether a notification counts toward the bell's
 * badge, kept pure so it can be tested without a database.
 *
 * D60 (2026-09-28) gave the bell per-user read state, partially reversing
 * ADR-014. The badge counts UNREAD items; the dropdown still lists every
 * item, read or not, because a read notification is not finished work.
 */

/** A read receipt from `notification_reads`, keyed the same way the view is. */
export type ReadReceipt = { kind: string; entityId: string; readAt: string };

/** The key under which a notification's read receipt is stored. */
export function readKey(kind: string, entityId: string): string {
  return `${kind}:${entityId}`;
}

export function receiptsByKey(receipts: readonly ReadReceipt[]): Map<string, string> {
  return new Map(receipts.map((r) => [readKey(r.kind, r.entityId), r.readAt]));
}

/**
 * Unread when the user has never opened it, OR when the work was raised again
 * AFTER they last opened it.
 *
 * That second clause is the whole reason `read_at` is a timestamp rather than
 * a boolean. `v_notifications` recomputes `created_at` from the underlying
 * row — `stock_requests.created_at`, `bills.submitted_at`,
 * `inventory_items.updated_at` — so a stock request that returns to pending,
 * or an item that drops below its reorder level a second time, presents a
 * newer `created_at` than the old receipt and correctly becomes unread again.
 * Without it, looking at a notification once would permanently silence that
 * entity.
 *
 * Equal timestamps count as READ: the receipt is written at or after the
 * moment the item was rendered, so `read_at === created_at` can only mean the
 * same occurrence, never a new one.
 */
export function isUnread(
  notification: { kind: string; entityId: string; createdAt: string },
  readAtByKey: ReadonlyMap<string, string>
): boolean {
  const readAt = readAtByKey.get(readKey(notification.kind, notification.entityId));
  if (readAt === undefined) return true;
  return Date.parse(notification.createdAt) > Date.parse(readAt);
}

export function countUnread(
  notifications: readonly { kind: string; entityId: string; createdAt: string }[],
  readAtByKey: ReadonlyMap<string, string>
): number {
  return notifications.reduce((n, item) => n + (isUnread(item, readAtByKey) ? 1 : 0), 0);
}
