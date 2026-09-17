import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromIsoDate, toIsoDate } from "./DatePicker";

/**
 * The picker must write exactly the `yyyy-mm-dd` string the native
 * `<input type="date">` it replaced wrote — bill and payment dates feed tax
 * documents. Run under a negative-offset TZ as well (`TZ=America/Los_Angeles`)
 * to catch a UTC-parse off-by-one.
 */
describe("DatePicker ISO conversion", () => {
  it.each(["2026-09-17", "2026-01-01", "2026-12-31", "2024-02-29", "2026-03-29"])(
    "round-trips %s unchanged",
    (iso) => {
      const date = fromIsoDate(iso);
      expect(date).toBeDefined();
      if (!date) return;
      expect(date.getDate()).toBe(Number(iso.slice(8, 10)));
      expect(toIsoDate(date)).toBe(iso);
    }
  );

  it("treats the empty and malformed values as no date", () => {
    expect(fromIsoDate("")).toBeUndefined();
    expect(fromIsoDate("17/09/2026")).toBeUndefined();
    expect(fromIsoDate("2026-9-17")).toBeUndefined();
  });

  it("writes the local calendar day of a picked date, zero-padded", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoDate(new Date(2026, 8, 17, 23, 59))).toBe("2026-09-17");
  });

  /**
   * The same strings must survive the round trip on a machine east of UTC
   * (where the app actually runs) and west of it (where an agent or a
   * travelling user might). A `new Date("yyyy-mm-dd")` parse or a
   * `toISOString()` format would shift the day in one of the two.
   */
  describe.each(["Asia/Kolkata", "America/Los_Angeles"])("under TZ=%s", (tz) => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = tz;
    });
    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it.each(["2026-09-17", "2026-01-01", "2026-12-31", "2024-02-29", "2026-11-01"])(
      "round-trips %s unchanged",
      (iso) => {
        const date = fromIsoDate(iso);
        expect(date).toBeDefined();
        if (!date) return;
        expect(date.getHours()).toBe(0);
        expect(toIsoDate(date)).toBe(iso);
      }
    );
  });
});
