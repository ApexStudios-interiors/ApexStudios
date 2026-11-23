"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/Tabs";
import { PROJECT_STATUS_FILTERS, type ProjectStatusFilter } from "@/features/projects/portfolio";

/** Matches the Packages and Inventory searches. */
const DEBOUNCE_MS = 300;

/**
 * All Projects' status tabs and search (APX-51) — `PackageSearchInput` and
 * `PackageStatusTabs`' own architecture: this owns typing, debouncing and the
 * tab click, writes `status` and `q` to the URL, and the Server Component
 * re-reads them and filters (`filterProjects`). So a filter survives a reload
 * and can be shared as a link. The default (no `status`) hides archived
 * projects; "All" is `?status=all`.
 */
export function ProjectListFilters({ status, q }: { status: ProjectStatusFilter; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [term, setTerm] = useState(q);
  /** The last term this component put in the URL — tells the echo of our own
   *  navigation apart from an external one such as Back. */
  const committed = useRef(q);

  useEffect(() => {
    if (q === committed.current) return;
    committed.current = q;
    setTerm(q);
  }, [q]);

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

  const onStatus = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("status", next);
    else params.delete("status");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0 mb-1">
      {/* Seven tabs are wider than a phone: they scroll inside their own strip
          rather than widening the page. */}
      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        <Tabs items={[...PROJECT_STATUS_FILTERS]} value={status} onChange={onStatus} />
      </div>
      <InputGroup className="w-full sm:w-64 mb-4">
        <InputGroupAddon>{isPending ? <Spinner /> : <SearchIcon />}</InputGroupAddon>
        <InputGroupInput
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search projects or clients…"
          aria-label="Search projects"
        />
      </InputGroup>
    </div>
  );
}
