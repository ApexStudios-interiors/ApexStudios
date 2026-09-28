"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { NotificationDTO } from "@/features/notifications/queries";
import { markNotificationRead } from "@/features/notifications/actions";
import { Icon } from "@/components/ui/Icon";
import { useClickOutside } from "@/hooks/useClickOutside";

/**
 * build/07-stock-inventory-notifications.md §2.6, amended by D60 (2026-09-28).
 *
 * Data arrives as a prop from the server (app/(app)/layout.tsx via
 * features/notifications/queries.ts). The badge counts UNREAD items; the list
 * shows everything, read or not, because a read notification is not finished
 * work — that is the part of D56 worth keeping.
 */
export function NotificationsMenu({ items }: { items: NotificationDTO[] }) {
  const [open, setOpen] = useState(false);
  /** Ids marked read in this tab, so the badge drops on click rather than
   *  waiting for the server round trip and the router refresh. Merged with
   *  the server's own `unread` below; the refresh then makes it durable. */
  const [justRead, setJustRead] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useClickOutside(ref, () => setOpen(false), open);

  const keyOf = (n: NotificationDTO) => `${n.kind}-${n.entityId}`;
  const isUnread = (n: NotificationDTO) => n.unread && !justRead.has(keyOf(n));
  const unreadCount = items.filter(isUnread).length;

  async function openNotification(n: NotificationDTO, e: React.MouseEvent) {
    // Let the browser handle a modified click (new tab, new window) exactly as
    // it would any link — intercepting those would break middle-click, and the
    // item simply stays unread, which is the safe direction to err in.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();

    setJustRead((prev) => new Set(prev).add(keyOf(n)));
    setOpen(false);

    // Awaited before navigating: a server action fired during a navigation can
    // be cancelled with the page, which would leave the badge back at its old
    // count on the next load — the exact symptom this exists to fix. A failure
    // must not strand the user on the menu, so navigation happens regardless.
    try {
      await markNotificationRead({ kind: n.kind, entityId: n.entityId });
    } catch {
      // Non-fatal: the item stays unread and can be opened again.
    }
    router.push(n.href);
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications, none unread"}
        className="relative h-8 w-8 grid place-items-center rounded-lg border border-input hover:bg-accent text-muted-foreground outline-none focus-visible:bg-accent"
      >
        <Icon name="bell" className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 text-[10px] font-semibold bg-primary text-primary-foreground rounded-full min-w-[16px] h-4 px-1 grid place-items-center">
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 bg-card border border-border rounded-lg shadow-lg py-1 max-h-96 overflow-auto">
          <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Notifications
          </div>
          {items.length ? (
            items.map((n) => {
              const unread = isUnread(n);
              return (
                <Link
                  key={keyOf(n)}
                  href={n.href}
                  onClick={(e) => void openNotification(n, e)}
                  aria-label={unread ? `${n.title} (unread)` : n.title}
                  className="flex items-start gap-2 px-3 py-2 text-[13px] hover:bg-accent"
                >
                  {/* A dot rather than colour alone, so read and unread are
                      distinguishable without relying on weight or hue. */}
                  <span
                    aria-hidden
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      unread ? "bg-primary" : "bg-transparent"
                    }`}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={`truncate ${
                        unread ? "font-medium text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {n.title}
                    </span>
                    {n.projectName && (
                      <span className="truncate text-xs text-muted-foreground">{n.projectName}</span>
                    )}
                  </span>
                </Link>
              );
            })
          ) : (
            <div className="px-3 py-6 text-center text-muted-foreground text-[13px]">
              You&apos;re all caught up.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
