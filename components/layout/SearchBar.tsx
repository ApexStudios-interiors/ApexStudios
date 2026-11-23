"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { searchAll } from "@/features/search/actions";
import type { SearchResultDTO } from "@/features/search/service";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button } from "@/components/ui/button";
import { useClickOutside } from "@/hooks/useClickOutside";

/**
 * build/07-stock-inventory-notifications.md §2.7. Replaces the in-memory
 * `buildSearchResults()` with the real `searchAll` Server Action —
 * role-scoping now lives entirely in `features/search/queries.ts`, this
 * component only owns typing, debouncing, and the open/close interaction.
 *
 * Debounced 300ms client-side, on top of the action's own 2-character
 * minimum and rate limit — three independent reasons a single fast typist
 * never sends seven queries per keystroke.
 *
 * APX-47: a labelled ARIA 1.2 combobox. Arrow keys move through the results
 * (aria-activedescendant, so focus stays in the input), Enter opens the
 * highlighted one, Escape closes the list — and on a phone the search too.
 *
 * APX-16: below `md` it collapses to an icon button that opens a full-width
 * search bar over the top of the header.
 */

const CATEGORY_ICON: Record<string, IconName> = {
  Projects: "folder",
  Packages: "mod",
  "Stock Requests": "box",
  Approvals: "check",
  Bills: "bill",
  Inventory: "archive",
  Users: "users",
};

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const { execute, result, isExecuting, reset } = useAction(searchAll);

  const close = () => {
    setOpen(false);
    setMobileOpen(false);
    setQuery("");
    setActive(-1);
    reset();
  };
  useClickOutside(ref, () => (mobileOpen ? close() : setOpen(false)), open || mobileOpen);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) {
      reset();
      return;
    }
    debounceRef.current = setTimeout(() => execute({ query: trimmed }), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execute/reset are stable per next-safe-action
  }, [query]);

  useEffect(() => {
    if (mobileOpen) inputRef.current?.focus();
  }, [mobileOpen]);

  const results: SearchResultDTO[] = useMemo(() => result.data ?? [], [result.data]);
  const grouped = useMemo(() => {
    const map = new Map<string, { r: SearchResultDTO; index: number }[]>();
    results.forEach((r, index) => {
      const bucket = map.get(r.category);
      if (bucket) bucket.push({ r, index });
      else map.set(r.category, [{ r, index }]);
    });
    return map;
  }, [results]);
  // Arrow-key order is the order the groups render in.
  const ordered = useMemo(() => [...grouped.values()].flat(), [grouped]);

  const go = (r: SearchResultDTO) => {
    close();
    router.push(r.href);
  };

  const trimmedQuery = query.trim();
  const showDropdown = open && trimmedQuery.length > 0;
  const tooShort = trimmedQuery.length > 0 && trimmedQuery.length < MIN_CHARS;
  const listOpen = showDropdown && !tooShort && !isExecuting && ordered.length > 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (showDropdown && !mobileOpen) {
        setOpen(false);
        setActive(-1);
      } else close();
      return;
    }
    if (!listOpen) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % ordered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? ordered.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const pick = ordered[active];
      if (pick) {
        e.preventDefault();
        go(pick.r);
      }
    }
  };

  const activeIndex = ordered[active]?.index ?? -1;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label="Search"
        onClick={() => setMobileOpen(true)}
      >
        <Icon name="search" className="w-4 h-4" />
      </Button>
      <div
        ref={ref}
        className={
          mobileOpen
            ? "fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border bg-background p-2.5 md:static md:z-auto md:w-64 md:border-0 md:p-0"
            : "relative w-64 max-md:hidden"
        }
      >
        <div className="relative flex-1">
          <div className="flex items-center gap-2 h-9 border border-input rounded-lg bg-background px-2.5 text-muted-foreground focus-within:border-ring">
            <Icon name="search" className="w-4 h-4 flex-none" />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label="Search projects, packages, requests, approvals and bills"
              aria-expanded={listOpen}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActive(-1);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Search..."
              className="w-full bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 bg-card border border-border rounded-lg shadow-lg py-1 max-h-96 max-md:max-h-[70dvh] overflow-auto overscroll-contain">
              {tooShort ? (
                <div className="px-3 py-6 text-center text-muted-foreground text-[13px]">
                  Type at least {MIN_CHARS} characters
                </div>
              ) : isExecuting ? (
                <div role="status" className="px-3 py-6 text-center text-muted-foreground text-[13px]">
                  Searching…
                </div>
              ) : result.serverError ? (
                <div role="alert" className="px-3 py-6 text-center text-muted-foreground text-[13px]">
                  {result.serverError}
                </div>
              ) : results.length ? (
                <div id={listId} role="listbox" aria-label="Search results">
                  {[...grouped.entries()].map(([cat, items]) => (
                    <div key={cat} role="group" aria-label={cat}>
                      <div
                        aria-hidden="true"
                        className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        {cat}
                      </div>
                      {items.map(({ r, index }) => (
                        <div
                          key={r.id}
                          id={optionId(index)}
                          role="option"
                          aria-selected={index === activeIndex}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => go(r)}
                          className={`flex items-center gap-2.5 px-3 py-2 text-[13px] cursor-pointer hover:bg-accent ${
                            index === activeIndex ? "bg-accent" : ""
                          }`}
                        >
                          <Icon
                            name={CATEGORY_ICON[cat] ?? "folder"}
                            className="w-3.5 h-3.5 text-muted-foreground flex-none"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground truncate">{r.text}</span>
                            <span className="block text-xs text-muted-foreground truncate">{r.sub}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div role="status" className="px-3 py-6 text-center text-muted-foreground text-[13px]">
                  No results for &quot;{query}&quot;
                </div>
              )}
            </div>
          )}
        </div>
        {mobileOpen && (
          <Button variant="ghost" size="sm" className="md:hidden" onClick={close}>
            Cancel
          </Button>
        )}
      </div>
    </>
  );
}
