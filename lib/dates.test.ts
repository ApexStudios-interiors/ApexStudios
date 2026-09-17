import { afterEach, describe, expect, it } from "vitest";
import { todayIst } from "./dates";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

/**
 * 18:30 UTC is 00:00 IST: the instant the Indian day rolls over. Everything
 * before it belongs to the previous IST day, everything from it to the next
 * day. This is precisely where `toISOString().slice(0, 10)` was wrong — it
 * changed day at 00:00 UTC, i.e. 05:30 IST, so a payment recorded at 06:00 IST
 * was dated yesterday.
 */
describe("todayIst", () => {
  it.each([
    ["2026-09-17T18:29:59.999Z", "2026-09-17"],
    ["2026-09-17T18:30:00.000Z", "2026-09-18"],
    ["2026-09-17T18:30:00.001Z", "2026-09-18"],
    ["2026-09-17T23:59:59.000Z", "2026-09-18"],
    ["2026-09-18T00:00:00.000Z", "2026-09-18"],
    ["2026-09-18T05:29:00.000Z", "2026-09-18"],
  ])("maps %s to %s", (instant, expected) => {
    expect(todayIst(new Date(instant))).toBe(expected);
  });

  it("rolls the month and the year over at 18:30 UTC, not at midnight UTC", () => {
    expect(todayIst(new Date("2026-09-30T18:29:00.000Z"))).toBe("2026-09-30");
    expect(todayIst(new Date("2026-09-30T18:30:00.000Z"))).toBe("2026-10-01");
    expect(todayIst(new Date("2026-12-31T18:30:00.000Z"))).toBe("2027-01-01");
    expect(todayIst(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
  });

  it("is zero-padded and leap-year correct", () => {
    expect(todayIst(new Date("2024-02-28T18:30:00.000Z"))).toBe("2024-02-29");
    expect(todayIst(new Date("2026-01-04T18:30:00.000Z"))).toBe("2026-01-05");
  });

  it.each(["Asia/Kolkata", "America/Los_Angeles", "UTC"])(
    "gives the same IST answer with the process in %s",
    (tz) => {
      process.env.TZ = tz;
      expect(todayIst(new Date("2026-09-17T18:29:00.000Z"))).toBe("2026-09-17");
      expect(todayIst(new Date("2026-09-17T18:31:00.000Z"))).toBe("2026-09-18");
    }
  );

  it("defaults to the current instant", () => {
    const before = new Date();
    const value = todayIst();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([todayIst(before), todayIst(new Date())]).toContain(value);
  });
});
