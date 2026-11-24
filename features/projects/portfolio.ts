/**
 * The All Projects page's attention ordering and its filter (APX-48, APX-51).
 * Pure — no `next/*`, no `server-only`, no database — so the ordering rules
 * and the filter are unit-tested without a round trip, the same reason
 * `service.ts` is pure. Kept in its own file rather than `service.ts` because
 * it is presentation ordering over DTOs, not a business rule.
 */

/**
 * What needs looking at on one project, as its All Projects card shows it.
 * Every field is role-shaped by `getPortfolioAttention`: a `null` means "not
 * shown to this role", never "zero".
 */
export type ProjectAttention = {
  /** Tasks past their end date and under 100% (schedule/service `isLate`). */
  lateTasks: number;
  pendingApprovals: number;
  /** Age in days of the oldest pending approval; null when there are none. */
  oldestApprovalDays: number | null;
  /** Certified-but-unpaid ₹. Admin only, and only while BILLING_ENABLED. */
  outstanding: number | null;
  /** Items at low or critical stock. null for a client (no stock visibility). */
  lowStock: number | null;
  /** Days since the newest daily update; null when the project has none. */
  lastUpdateDays: number | null;
};

export const NO_ATTENTION: ProjectAttention = {
  lateTasks: 0,
  pendingApprovals: 0,
  oldestApprovalDays: null,
  outstanding: null,
  lowStock: null,
  lastUpdateDays: null,
};

/** An approval waiting this long is "aged" (HLD's aged-item tiles use a week). */
export const AGED_APPROVAL_DAYS = 7;
/** A live site with no update for this long is worth a nudge. */
export const STALE_UPDATE_DAYS = 3;

/** Statuses that are finished with — they sort last, whatever their counts. */
const DORMANT_STATUSES = new Set(["Completed", "Archived"]);

/**
 * How loudly a project asks for attention. Higher first. The weights are an
 * ordering, not a metric: late work outranks a waiting approval, which
 * outranks low stock; an aged approval and a quiet site add a nudge each.
 * A completed or archived project scores below every live one.
 */
export function attentionScore(status: string, a: ProjectAttention): number {
  if (DORMANT_STATUSES.has(status)) return -1;
  let score = 0;
  score += a.lateTasks * 3;
  score += a.pendingApprovals * 2;
  if (a.oldestApprovalDays != null && a.oldestApprovalDays >= AGED_APPROVAL_DAYS) score += 3;
  if (a.outstanding != null && a.outstanding > 0) score += 2;
  score += a.lowStock ?? 0;
  if (status === "Active" && (a.lastUpdateDays == null || a.lastUpdateDays >= STALE_UPDATE_DAYS)) score += 1;
  return score;
}

/**
 * Projects by attention, highest first. Stable: ties keep the order they came
 * in (oldest start date first, from `fetchProjectRows`), so a calm portfolio
 * reads exactly as it did before this ordering existed.
 */
export function sortByAttention<T extends { id: string; status: string }>(
  projects: readonly T[],
  attention: Readonly<Record<string, ProjectAttention>>
): T[] {
  return projects
    .map((p, i) => ({ p, i, s: attentionScore(p.status, attention[p.id] ?? NO_ATTENTION) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p);
}

/** Whole days from `from` to `to`, both `yyyy-MM-dd`. Parsed on their own
 *  Y/M/D (never `new Date("yyyy-MM-dd")`, AGENTS.md), so DST and the viewer's
 *  timezone play no part. Never negative: a future date is "0 days ago". */
export function daysBetween(from: string, to: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.max(0, Math.round((ms(to) - ms(from)) / 86_400_000));
}

/** "today", "yesterday", "5 days ago" — the card's last-update line. */
export function daysAgoLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// ── All Projects filter ──────────────────────────────────────────────────────

/** The status tabs, in display order. `""` is the default: every project
 *  except archived ones (an archived project is history, not work). `all`
 *  really is all, archived included. */
export const PROJECT_STATUS_FILTERS = [
  { key: "", label: "Current" },
  { key: "active", label: "Active" },
  { key: "planning", label: "Planning" },
  { key: "on_hold", label: "On Hold" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
] as const;

export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number]["key"];

/** Display labels the DTO carries (features/projects/service `projectStatusLabel`). */
const FILTER_LABEL: Record<Exclude<ProjectStatusFilter, "" | "all">, string> = {
  active: "Active",
  planning: "Planning",
  on_hold: "On Hold",
  completed: "Completed",
  archived: "Archived",
};

/** An unrecognised `?status=` (a typo, a stale link) is the default view,
 *  not an empty list. */
export function parseProjectStatusFilter(raw: string | undefined): ProjectStatusFilter {
  return PROJECT_STATUS_FILTERS.some((f) => f.key === raw) ? (raw as ProjectStatusFilter) : "";
}

/** Long enough for any project or client name; short enough to stay cheap. */
const SEARCH_MAX_LENGTH = 80;

export function normaliseProjectSearch(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
}

/**
 * Narrows the portfolio by status tab and by a free-text search over the
 * project name, client, code and location (case-insensitive substring). The
 * portfolio is already fully loaded for the stat row and the sidebar, so this
 * filters in memory rather than re-querying.
 */
export function filterProjects<
  T extends { name: string; client: string; code: string; location: string | null; status: string },
>(projects: readonly T[], filter: { status: ProjectStatusFilter; q: string }): T[] {
  const needle = filter.q.toLowerCase();
  return projects.filter((p) => {
    if (filter.status === "" && p.status === "Archived") return false;
    if (filter.status !== "" && filter.status !== "all" && p.status !== FILTER_LABEL[filter.status]) {
      return false;
    }
    if (!needle) return true;
    return [p.name, p.client, p.code, p.location ?? ""].some((v) => v.toLowerCase().includes(needle));
  });
}
