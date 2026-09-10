import { describe, expect, it } from "vitest";
import { isLate, monthHeaders, taskEndDate, viewportWeeks, weekIndex, weightedProgress } from "./service";

describe("weekIndex", () => {
  it("is 0 for a task starting on the project start date", () => {
    expect(weekIndex("2026-08-24", "2026-08-24")).toBe(0);
  });

  it("is 1 exactly seven days later", () => {
    expect(weekIndex("2026-08-31", "2026-08-24")).toBe(1);
  });

  it("is still 0 six days later", () => {
    expect(weekIndex("2026-08-30", "2026-08-24")).toBe(0);
  });

  it("is negative for a task starting before the project start — not clamped", () => {
    expect(weekIndex("2026-08-17", "2026-08-24")).toBe(-1);
  });
});

describe("taskEndDate", () => {
  it("3 weeks from 2026-08-24 ends 2026-09-13 (21 days minus one)", () => {
    expect(taskEndDate("2026-08-24", 3)).toBe("2026-09-13");
  });

  it("a 1-week task ends 6 days after it starts", () => {
    expect(taskEndDate("2026-08-24", 1)).toBe("2026-08-30");
  });

  // Postgres's own generated column, and Postgres month-end arithmetic, share
  // this exact formula — this is the case where a naive `setMonth`/`setDate`
  // local-timezone approach would drift.
  it("carries over a month and a year boundary correctly", () => {
    expect(taskEndDate("2026-12-28", 1)).toBe("2027-01-03");
  });
});

describe("isLate", () => {
  it("is false at exactly 100%, even overdue", () => {
    expect(isLate({ endDate: "2026-08-01", progressPct: 100 }, "2026-09-01")).toBe(false);
  });

  it("is true at 99% once the end date has passed", () => {
    expect(isLate({ endDate: "2026-08-01", progressPct: 99 }, "2026-09-01")).toBe(true);
  });

  it("is false before the end date, whatever the progress", () => {
    expect(isLate({ endDate: "2026-09-01", progressPct: 0 }, "2026-08-01")).toBe(false);
  });

  it("is false exactly on the end date — overdue starts the day after", () => {
    expect(isLate({ endDate: "2026-09-01", progressPct: 50 }, "2026-09-01")).toBe(false);
  });
});

describe("weightedProgress", () => {
  it("T-16: a 3-week task at 100% and a 1-week task at 0% is 75%, not 50%", () => {
    expect(
      weightedProgress([
        { durationWeeks: 3, progressPct: 100 },
        { durationWeeks: 1, progressPct: 0 },
      ])
    ).toBe(75);
  });

  it("is 0 for an empty task list rather than dividing by zero", () => {
    expect(weightedProgress([])).toBe(0);
  });

  it("a zero-duration task is the database check constraint's job to reject, not this function's — but it must not throw or return NaN if one somehow appears with an otherwise-normal list", () => {
    const pct = weightedProgress([
      { durationWeeks: 0, progressPct: 100 },
      { durationWeeks: 2, progressPct: 50 },
    ]);
    expect(Number.isFinite(pct)).toBe(true);
  });
});

describe("viewportWeeks", () => {
  const PROJECT_START = "2026-08-24";

  it("defaults to a 14-week window from the project start when the project just began", () => {
    const win = viewportWeeks(
      PROJECT_START,
      [{ startDate: "2026-08-24", endDate: "2026-08-30" }],
      "2026-08-25"
    );
    expect(win).toEqual({ from: 0, to: 13 });
  });

  it("widens leftward (never clamps) for a task starting before the project", () => {
    const win = viewportWeeks(
      PROJECT_START,
      [{ startDate: "2026-08-10", endDate: "2026-08-16" }],
      "2026-08-25"
    );
    expect(win.from).toBe(-2);
  });

  it("widens rightward for a task running past the default 14-week window", () => {
    const win = viewportWeeks(
      PROJECT_START,
      [{ startDate: "2027-06-01", endDate: "2027-06-07" }],
      "2026-08-25"
    );
    expect(win.to).toBeGreaterThan(13);
  });

  it("shifts to include today when the project is already well under way", () => {
    // ~40 weeks after the project start — week 1 of a 14-week default window
    // would not even show today.
    const farToday = taskEndDate(PROJECT_START, 40);
    const win = viewportWeeks(PROJECT_START, [], farToday);
    const todayIdx = weekIndex(farToday, PROJECT_START);
    expect(win.from).toBeLessThanOrEqual(todayIdx);
    expect(win.to).toBeGreaterThanOrEqual(todayIdx);
  });

  it("returns the plain 14-week default for a project with no tasks at all", () => {
    expect(viewportWeeks(PROJECT_START, [], "2026-08-25")).toEqual({ from: 0, to: 13 });
  });
});

describe("monthHeaders", () => {
  it("groups a range spanning one month boundary into two spans", () => {
    // 2026-08-24 is a Monday; week 0 = Aug 24, week 1 = Aug 31 (still
    // August), week 2 = Sep 7 (September).
    const headers = monthHeaders("2026-08-24", 0, 2);
    expect(headers).toEqual([
      { label: "Aug 2026", span: 2 },
      { label: "Sep 2026", span: 1 },
    ]);
  });

  it("is one span when the whole range stays inside one month", () => {
    expect(monthHeaders("2026-09-07", 0, 1)).toEqual([{ label: "Sep 2026", span: 2 }]);
  });
});
