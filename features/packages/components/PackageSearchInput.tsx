"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

/**
 * The Packages page's search — `InventorySearchInput`'s own architecture: it
 * owns nothing but typing and debouncing, writes `q` to the URL, and the
 * Server Component re-reads it and filters (`filterPackageRows`), so a search
 * composes with the status tabs and survives a reload or a shared link.
 */

/** Matches the global SearchBar's and the Inventory search's debounce. */
const DEBOUNCE_MS = 300;

export function PackageSearchInput({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [term, setTerm] = useState(value);
  /** The last term this component put in the URL — separates the echo of our
   *  own navigation from an external one such as Back. */
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
      const qs = params.toString();
      // `replace`, not `push`: Back should not walk letter by letter.
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, router, pathname, searchParams]);

  return (
    <InputGroup className="w-64 mb-4">
      <InputGroupAddon>{isPending ? <Spinner /> : <SearchIcon />}</InputGroupAddon>
      <InputGroupInput
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search packages…"
        aria-label="Search packages"
      />
    </InputGroup>
  );
}
