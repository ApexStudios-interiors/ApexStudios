"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import { buildSearchResults, SearchResult } from "@/lib/logic";
import { Icon, IconName } from "@/components/ui/Icon";
import { useClickOutside } from "@/hooks/useClickOutside";

const CATEGORY_ICON: Record<string, IconName> = {
  Projects: "folder",
  Packages: "mod",
  "Stock Requests": "box",
  Approvals: "check",
  Bills: "bill",
  Inventory: "archive",
  Users: "users",
};

export function SearchBar() {
  const { data, role } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const results = useMemo(() => buildSearchResults(data, role, query), [data, role, query]);
  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    results.slice(0, 30).forEach((r) => {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    });
    return map;
  }, [results]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative w-64" ref={ref}>
      <div className="flex items-center gap-2 h-9 border border-input rounded-lg bg-background px-2.5 text-muted-foreground focus-within:border-ring">
        <Icon name="search" className="w-4 h-4 flex-none" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search..."
          className="w-full bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground"
        />
      </div>
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 bg-card border border-border rounded-lg shadow-lg py-1 max-h-96 overflow-auto">
          {results.length ? (
            [...grouped.entries()].map(([cat, items]) => (
              <div key={cat}>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{cat}</div>
                {items.map((r) => (
                  <Link
                    key={r.id}
                    href={r.href}
                    onClick={close}
                    className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-accent"
                  >
                    <Icon name={CATEGORY_ICON[cat] ?? "folder"} className="w-3.5 h-3.5 text-muted-foreground flex-none" />
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground truncate">{r.text}</span>
                      <span className="block text-xs text-muted-foreground truncate">{r.sub}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ))
          ) : (
            <div className="px-3 py-6 text-center text-muted-foreground text-[13px]">No results for &quot;{query}&quot;</div>
          )}
        </div>
      )}
    </div>
  );
}
