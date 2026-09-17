import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  fetchPage,
  pageCount,
  pageItems,
  pageRange,
  parsePageRequest,
  shownRange,
  withPage,
  type RangeResult,
} from "./pagination";

describe("parsePageRequest", () => {
  it("defaults to page 1 and 10 rows", () => {
    expect(parsePageRequest({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(DEFAULT_PAGE_SIZE).toBe(10);
  });

  it("reads a valid page and page size", () => {
    expect(parsePageRequest({ page: "3", pageSize: "25" })).toEqual({ page: 3, pageSize: 25 });
    expect(parsePageRequest({ page: ["4", "9"], pageSize: ["50"] })).toEqual({ page: 4, pageSize: 50 });
  });

  it.each(["0", "-2", "1.5", "abc", "", "99999999999999999999"])("falls back to page 1 for %j", (page) => {
    expect(parsePageRequest({ page }).page).toBe(1);
  });

  it.each(["7", "100000", "0", "x"])("refuses page size %j", (pageSize) => {
    expect(parsePageRequest({ pageSize }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("page arithmetic", () => {
  it("maps a page to PostgREST's inclusive range", () => {
    expect(pageRange({ page: 1, pageSize: 10 })).toEqual({ from: 0, to: 9 });
    expect(pageRange({ page: 2, pageSize: 10 })).toEqual({ from: 10, to: 19 });
  });

  it("counts pages, never fewer than one", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(10, 10)).toBe(1);
    expect(pageCount(47, 10)).toBe(5);
  });

  it("describes the rows shown", () => {
    expect(shownRange(2, 10, 47)).toEqual({ from: 11, to: 20 });
    expect(shownRange(5, 10, 47)).toEqual({ from: 41, to: 47 });
    expect(shownRange(1, 10, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("pageItems", () => {
  it("lists every page when there are few", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("collapses gaps into an ellipsis, but never a gap of one page", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, "ellipsis", 20]);
    expect(pageItems(10, 20)).toEqual([1, "ellipsis", 9, 10, 11, "ellipsis", 20]);
    expect(pageItems(3, 20)).toEqual([1, 2, 3, 4, "ellipsis", 20]);
    expect(pageItems(20, 20)).toEqual([1, "ellipsis", 19, 20]);
  });
});

describe("withPage", () => {
  it("keeps every other param and drops page for page 1", () => {
    const params = new URLSearchParams("project=p1&q=tiles&page=3&pageSize=25");
    expect(withPage(params, 4)).toBe("project=p1&q=tiles&page=4&pageSize=25");
    expect(withPage(params, 1)).toBe("project=p1&q=tiles&pageSize=25");
    expect(params.get("page")).toBe("3");
  });
});

/** A fake PostgREST over `total` rows, numbered 0…total-1. `strict` mimics
 *  an exact-count request past the end: a 416 with no count. */
function fakeTable(total: number, strict: boolean) {
  const calls: [number, number][] = [];
  const run = async (from: number, to: number): Promise<RangeResult<number>> => {
    calls.push([from, to]);
    if (strict && from >= total && from > 0) {
      return {
        data: null,
        count: null,
        error: { message: "Requested range not satisfiable", code: "PGRST103" },
      };
    }
    const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i);
    return { data: rows, count: total, error: null };
  };
  return { run, calls };
}

describe("fetchPage", () => {
  it("fetches only the requested page", async () => {
    const table = fakeTable(47, true);
    const page = await fetchPage(table.run, { page: 2, pageSize: 10 });
    expect(page).toEqual({
      rows: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      total: 47,
      page: 2,
      pageSize: 10,
    });
    expect(table.calls).toEqual([[10, 19]]);
  });

  it.each([true, false])("clamps an out-of-range page to the last page (416: %s)", async (strict) => {
    const table = fakeTable(47, strict);
    const page = await fetchPage(table.run, { page: 99, pageSize: 10 });
    expect(page.page).toBe(5);
    expect(page.rows).toEqual([40, 41, 42, 43, 44, 45, 46]);
    expect(page.total).toBe(47);
  });

  it.each([true, false])("returns an empty first page when nothing matches (416: %s)", async (strict) => {
    const table = fakeTable(0, strict);
    expect(await fetchPage(table.run, { page: 3, pageSize: 10 })).toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
  });

  it("throws any other error", async () => {
    const run = async (): Promise<RangeResult<number>> => ({
      data: null,
      count: null,
      error: { message: "permission denied", code: "42501" },
    });
    await expect(fetchPage(run, { page: 2, pageSize: 10 })).rejects.toThrow("permission denied");
  });

  it("does not retry page 1", async () => {
    const run = async (): Promise<RangeResult<number>> => ({
      data: null,
      count: null,
      error: { message: "Requested range not satisfiable", code: "PGRST103" },
    });
    await expect(fetchPage(run, { page: 1, pageSize: 10 })).rejects.toThrow("not satisfiable");
  });
});
