/**
 * Server-side table pagination, shared by every paginated table.
 *
 * Page state is URL state — `page` (1-based) and `pageSize` — read by the
 * page's Server Component and applied in the Supabase query as `.range()`
 * with `count: "exact"`, so only the current page ever leaves the database.
 * `TablePagination` (components/shared) writes the same two params back.
 *
 * Pure: no `next/*`, no Supabase client — `fetchPage` takes the query as a
 * callback, so the out-of-range handling is unit-testable without a database.
 */

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/** The URL params. Filters delete `PAGE_PARAM` on change so a new filter
 *  always starts on page 1; `PAGE_SIZE_PARAM` survives a filter change. */
export const PAGE_PARAM = "page";
export const PAGE_SIZE_PARAM = "pageSize";

export type PageRequest = { page: number; pageSize: number };

export type Page<T> = {
  rows: T[];
  /** Every row matching the filters, not just this page. */
  total: number;
  /** The page actually returned — can be lower than the one requested. */
  page: number;
  pageSize: number;
};

type SearchParamValue = string | string[] | undefined;

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Anything that is not a positive whole number falls back to page 1 and the
 *  default size; a size outside `PAGE_SIZE_OPTIONS` is refused rather than
 *  honoured, so `?pageSize=100000` cannot turn pagination back off. */
export function parsePageRequest(params: {
  page?: SearchParamValue;
  pageSize?: SearchParamValue;
}): PageRequest {
  const rawPage = first(params.page);
  const page = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const rawSize = Number(first(params.pageSize));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE;
  return { page: Number.isSafeInteger(page) && page >= 1 ? page : 1, pageSize };
}

/** Inclusive row offsets, as PostgREST's `.range(from, to)` takes them. */
export function pageRange({ page, pageSize }: PageRequest): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** "Showing 11–20 of 47": 1-based, inclusive. Zero rows is 0–0. */
export function shownRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(page * pageSize, total) };
}

/** The page-number buttons: always the first and last page, the current page
 *  and its neighbours, and an ellipsis for each gap of more than one page. */
export function pageItems(current: number, count: number): (number | "ellipsis")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const wanted = new Set([1, count, current - 1, current, current + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const items: (number | "ellipsis")[] = [];
  let previous = 0;
  for (const p of pages) {
    if (p - previous === 2) items.push(previous + 1);
    else if (p - previous > 2) items.push("ellipsis");
    items.push(p);
    previous = p;
  }
  return items;
}

/** The query string for `page`, keeping every other param (filters, search,
 *  page size) as it is. Page 1 is the bare URL, not `?page=1`. */
export function withPage(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  if (page > 1) next.set(PAGE_PARAM, String(page));
  else next.delete(PAGE_PARAM);
  return next.toString();
}

/** The part of a supabase-js response `fetchPage` reads. */
export type RangeResult<Row> = {
  data: Row[] | null;
  count: number | null;
  error: { message: string; code?: string } | null;
};

/** PostgREST's "Requested range not satisfiable" — an offset past the end. */
const RANGE_NOT_SATISFIABLE = "PGRST103";

/**
 * Runs `run(from, to)` — a query built with `count: "exact"` and ending in
 * `.range(from, to)` — for the requested page.
 *
 * An out-of-range page (`?page=99` after rows were deleted, or a stale link)
 * never renders as a blank table with no way back: the last page that has
 * rows is fetched and returned instead, and `page` says which one it was, so
 * the footer highlights the page actually shown. PostgREST reports that case
 * either as an empty 200 or, with an exact count, as a 416 (`PGRST103`) that
 * carries no count — then one `range(0, 0)` read supplies it.
 */
export async function fetchPage<Row>(
  run: (from: number, to: number) => PromiseLike<RangeResult<Row>>,
  req: PageRequest
): Promise<Page<Row>> {
  const { from, to } = pageRange(req);
  const result = await run(from, to);

  let total: number;
  if (result.error) {
    if (result.error.code !== RANGE_NOT_SATISFIABLE || req.page === 1) throw new Error(result.error.message);
    const probe = await run(0, 0);
    if (probe.error) throw new Error(probe.error.message);
    total = probe.count ?? 0;
  } else {
    const rows = result.data ?? [];
    total = result.count ?? rows.length;
    if (rows.length > 0 || req.page === 1) return { rows, total, page: req.page, pageSize: req.pageSize };
  }

  // No rows match at all: the first page, empty, so the table's own empty
  // state renders.
  if (total === 0) return { rows: [], total: 0, page: 1, pageSize: req.pageSize };

  const last = pageCount(total, req.pageSize);
  // The count says this page exists but it came back empty — rows changed
  // between the two reads. Returned as it is; the footer still links back.
  if (last >= req.page) return { rows: [], total, page: req.page, pageSize: req.pageSize };

  const retryRange = pageRange({ page: last, pageSize: req.pageSize });
  const retry = await run(retryRange.from, retryRange.to);
  if (retry.error) throw new Error(retry.error.message);
  return { rows: retry.data ?? [], total: retry.count ?? total, page: last, pageSize: req.pageSize };
}
