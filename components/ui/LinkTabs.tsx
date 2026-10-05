"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * Same markup and classes as `Tabs` — build/04-projects-packages-phases.md
 * §4.4: "Keep the tab bar's appearance identical — only the navigation
 * mechanism changes." Package tabs are now routes (`02-lld.md` §8.1), so the
 * active tab is read from the URL instead of local state, and a click is a
 * navigation instead of a state update.
 */
export function LinkTabs({ items }: { items: { key: string; label: string; href: string }[] }) {
  // Match on the child route segment (e.g. "billing"), not the full path:
  // middleware rewrites readable slugs to UUIDs, so the hrefs (built from the
  // UUID params) never equal the slug-based URL `usePathname()` returns.
  const segment = useSelectedLayoutSegment();
  return (
    <div className="inline-flex bg-muted rounded-lg p-1 gap-0.5 mb-4">
      {items.map((it) => {
        const active = segment === it.href.split("/").filter(Boolean).pop();
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`border-0 rounded-md px-3 py-1.5 text-[13.5px] cursor-pointer ${
              active
                ? "bg-background text-foreground font-semibold shadow-sm"
                : "bg-transparent text-muted-foreground font-medium hover:text-foreground"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
