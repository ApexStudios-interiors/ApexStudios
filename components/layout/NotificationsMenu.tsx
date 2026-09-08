"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import { buildNotifications } from "@/lib/logic";
import { Icon } from "@/components/ui/Icon";
import { useClickOutside } from "@/hooks/useClickOutside";

export function NotificationsMenu() {
  const { data, role } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const items = buildNotifications(data, role);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative h-8 w-8 grid place-items-center rounded-lg border border-input hover:bg-accent text-muted-foreground outline-none focus-visible:bg-accent"
      >
        <Icon name="bell" className="w-4 h-4" />
        {items.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 text-[10px] font-semibold bg-primary text-primary-foreground rounded-full min-w-[16px] h-4 px-1 grid place-items-center">
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 bg-card border border-border rounded-lg shadow-lg py-1 max-h-96 overflow-auto">
          <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Notifications
          </div>
          {items.length ? (
            items.map((n) => (
              <Link
                key={n.id}
                href={n.href}
                onClick={() => setOpen(false)}
                className="flex flex-col px-3 py-2 text-[13px] hover:bg-accent"
              >
                <span className="font-medium text-foreground truncate">{n.text}</span>
                <span className="text-xs text-muted-foreground truncate">{n.sub}</span>
              </Link>
            ))
          ) : (
            <div className="px-3 py-6 text-center text-muted-foreground text-[13px]">You&apos;re all caught up.</div>
          )}
        </div>
      )}
    </div>
  );
}
