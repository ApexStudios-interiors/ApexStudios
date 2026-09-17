import { Skeleton } from "@/components/ui/skeleton";

/**
 * A table before its rows arrive, for a route's `loading.tsx`. Matches
 * `TableWrap`/`components/ui/table`'s own metrics — the 680px minimum width,
 * the 40px header row, the 12px cell padding — so the real table drops into
 * the space this reserved rather than pushing the page around.
 *
 * `rows` defaults to the 10 rows a page of a paginated table holds
 * (lib/pagination.ts's `DEFAULT_PAGE_SIZE`).
 */
export function TableSkeleton({ columns, rows = 10 }: { columns: number; rows?: number }) {
  const cells = Array.from({ length: columns });
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
        <div className="flex h-10 items-center gap-4 border-b border-border px-3">
          {cells.map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex h-11 items-center gap-4 border-b border-border px-3 last:border-b-0">
            {cells.map((_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
