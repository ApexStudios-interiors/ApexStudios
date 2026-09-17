"use client";

import { useTransition, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_PARAM,
  PAGE_SIZE_OPTIONS,
  PAGE_SIZE_PARAM,
  pageCount,
  pageItems,
  shownRange,
  withPage,
} from "@/lib/pagination";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const SIZE_ITEMS = PAGE_SIZE_OPTIONS.map((size) => ({ label: String(size), value: String(size) }));

/**
 * The one footer every paginated table uses: "Showing 11–20 of 47", rows per
 * page, previous/next and page numbers.
 *
 * `page`, `pageSize` and `total` come from the server's own `fetchPage`
 * result (lib/pagination.ts), never from the URL directly — so an
 * out-of-range `?page=99` that the server clamped to the last page highlights
 * the page actually shown. Navigation writes `page`/`pageSize` into the
 * CURRENT search params, so filters, search and status tabs are kept.
 *
 * Every page number is a real link (open in a new tab, copy link); a plain
 * click navigates inside a transition instead, so the Spinner can show while
 * the next page's rows are fetched.
 */
export function TablePagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (total === 0) return null;

  const count = pageCount(total, pageSize);
  const shown = shownRange(page, pageSize, total);

  const hrefFor = (target: number) => {
    const qs = withPage(new URLSearchParams(searchParams), target);
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));

  const onPageClick = (target: number) => (event: MouseEvent<HTMLAnchorElement>) => {
    // Modified clicks keep the browser's own behaviour (new tab, new window).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (target !== page) navigate(hrefFor(target));
  };

  const onPageSizeChange = (next: string | null) => {
    const size = Number(next);
    if (!size || size === pageSize) return;
    const params = new URLSearchParams(searchParams);
    if (size === DEFAULT_PAGE_SIZE) params.delete(PAGE_SIZE_PARAM);
    else params.set(PAGE_SIZE_PARAM, String(size));
    // A different page size makes the old page number meaningless.
    params.delete(PAGE_PARAM);
    const qs = params.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname);
  };

  const hasPrevious = page > 1;
  const hasNext = page < count;
  const disabled = "pointer-events-none opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 border-t border-border text-[13px] text-muted-foreground">
      <div className="flex items-center gap-2" aria-live="polite">
        <span>
          Showing {shown.from}–{shown.to} of {total}
        </span>
        {isPending && <Spinner />}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        {total > PAGE_SIZE_OPTIONS[0] && (
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select items={SIZE_ITEMS} value={String(pageSize)} onValueChange={onPageSizeChange}>
              <SelectTrigger size="sm" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {count > 1 && (
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href={hasPrevious ? hrefFor(page - 1) : undefined}
                  aria-disabled={!hasPrevious}
                  className={hasPrevious ? undefined : disabled}
                  onClick={hasPrevious ? onPageClick(page - 1) : undefined}
                />
              </PaginationItem>
              {pageItems(page, count).map((item, i) =>
                item === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink href={hrefFor(item)} isActive={item === page} onClick={onPageClick(item)}>
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  href={hasNext ? hrefFor(page + 1) : undefined}
                  aria-disabled={!hasNext}
                  className={hasNext ? undefined : disabled}
                  onClick={hasNext ? onPageClick(page + 1) : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    </div>
  );
}
