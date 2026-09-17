/**
 * "Today" for this business, which operates in one place: India.
 *
 * Every calendar-day default and comparison in the app — a payment's date, a
 * task's late flag, the Gantt's today line — means today in Asia/Kolkata. It
 * cannot be UTC (`new Date().toISOString().slice(0, 10)` is still yesterday
 * until 05:30 IST, and Vercel runs in UTC), and it cannot be the viewer's own
 * clock (correct in Mumbai, a day out for anyone travelling or testing from
 * another timezone, and a hydration mismatch between the two).
 *
 * `Intl` is banned by ESLint in `app/`, `components/`, `features/` and
 * `context/` so that currency formatting stays in `lib/money`; `lib/` is where
 * a timezone-aware formatter is allowed to live, and this is the only one.
 *
 * NOT for the backup and cron paths (`app/api/backup/report`,
 * `app/api/cron/[job]`, `lib/jobs/handlers/backup.verify`): those keys must
 * match the workflow's `date -u +%F` object key and the UTC cron period, and
 * are deliberately UTC.
 */

/** The one timezone this business keeps its books in. */
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today's date in the business timezone as `yyyy-MM-dd` — the same date-only
 * shape Postgres's `date` type and every form field here use. Identical on the
 * server (UTC) and in the browser, whatever the viewer's own timezone is.
 *
 * `now` is injectable so the 18:30 UTC (00:00 IST) boundary can be tested.
 */
export function todayIst(now: Date = new Date()): string {
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
