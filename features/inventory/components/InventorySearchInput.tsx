"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

/**
 * The Inventory toolbar's item search. Same architecture as
 * `InventoryProjectFilterSelect` next to it, and for the same reason: this
 * component owns nothing but typing and debouncing — it writes `q` to the URL
 * and the Server Component re-reads it, so the filtering itself happens in
 * the database query (`features/inventory/queries.ts`), composes with the
 * project filter, and survives a reload or a shared link.
 */

/** Matches the global SearchBar's own debounce. Long enough that a fast
 *  typist causes one navigation rather than one per keystroke. */
const DEBOUNCE_MS = 300;

export function InventorySearchInput({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [term, setTerm] = useState(value);
  /** The last term this component put in the URL. It is what separates the
   *  echo of our own navigation (ignore — resetting `term` there would fight
   *  the cursor position) from a genuinely external one such as Back. */
  const committed = useRef(value);

  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setTerm(value);
  }, [value]);

  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = trimmed;
      const params = new URLSearchParams(searchParams);
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      // A new search restarts pagination, exactly as changing the project
      // filter does — a cursor from the unsearched list means nothing in the
      // searched one.
      params.delete("cursor");
      const qs = params.toString();
      // `replace`, not `push`: each 300ms pause would otherwise leave its own
      // history entry, so Back would walk the user letter by letter back out
      // of a word they typed once.
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, router, pathname, searchParams]);

  return (
    <InputGroup className="w-64">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search items…"
        aria-label="Search inventory items"
      />
    </InputGroup>
  );
}
