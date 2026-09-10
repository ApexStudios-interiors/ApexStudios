/**
 * Pure. No next/* imports — testable against a plain connection or no
 * connection at all (HLD §4.3, code-standards §1).
 */

/** package_status -> the prototype's display strings. The enum is the source
 *  of truth; this is a presentation concern, not a schema one. */
const PACKAGE_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  design: "Design",
  in_progress: "In progress",
  completed: "Completed",
};

export function packageStatusLabel(status: string): string {
  return PACKAGE_STATUS_LABEL[status] ?? status;
}

/**
 * HLD §5.2: phases are not enforced to sum to the package total — real
 * projects hold unallocated contingency. This computes the variance so the UI
 * can surface it; it must never be used to block a write.
 */
export function phaseVariance(packageAllocated: number, phaseAllocatedSum: number): number {
  return packageAllocated - phaseAllocatedSum;
}

/**
 * T-16 (build/04-projects-packages-phases.md's test matrix): a package's
 * progress is weighted by its allocated amount, not a plain average — a ₹40L
 * package at 100% and a ₹2L package at 0% is 95% of the project, not 50%.
 *
 * `projects.progress_pct` is already trigger-maintained with this exact
 * formula (supabase/migrations/20260909170016_triggers_rollup.sql, "the
 * allocated-weighted mean of its packages") — queries.ts reads that cached
 * column directly rather than recomputing it, per AGENTS.md's rule against
 * storing a derived value one place and recomputing it in another. This
 * function is the pure, unit-testable statement of the same formula: its job
 * is to be the oracle T-16 checks the SQL trigger against, not a second
 * runtime code path.
 */
export function weightedProgress(items: { allocated: number; progressPct: number }[]): number {
  const totalAllocated = items.reduce((sum, i) => sum + i.allocated, 0);
  if (totalAllocated === 0) return 0;
  const weighted = items.reduce((sum, i) => sum + i.progressPct * i.allocated, 0);
  return Math.round(weighted / totalAllocated);
}

/**
 * T-16's other half: a package's own progress is the duration-weighted mean
 * of its tasks — a 3-week task at 100% and a 1-week task at 0% is 75%, not
 * 50%. Mirrors, and is the oracle for, the same trigger's `v_pkg_progress`
 * calculation (`sum(duration_weeks * progress_pct) / sum(duration_weeks)`).
 */
export function durationWeightedProgress(tasks: { durationWeeks: number; progressPct: number }[]): number {
  const totalWeeks = tasks.reduce((sum, t) => sum + t.durationWeeks, 0);
  if (totalWeeks === 0) return 0;
  const weighted = tasks.reduce((sum, t) => sum + t.durationWeeks * t.progressPct, 0);
  return Math.round(weighted / totalWeeks);
}

const COMMITTED_STATUSES = new Set(["approved", "ordered", "delivered"]);

/**
 * The oracle for `v_package_rollup.committed` (02-lld.md §4.1): only
 * `approved`, `ordered` and `delivered` stock requests count toward what a
 * package has committed. `pending` isn't a spend yet and `rejected` never
 * happened — including either would overstate how much of the budget is
 * actually spoken for.
 */
export function computeCommitted(requests: { status: string; qty: number; rate: number | null }[]): number {
  return requests
    .filter((r) => COMMITTED_STATUSES.has(r.status))
    .reduce((sum, r) => sum + r.qty * (r.rate ?? 0), 0);
}

/**
 * The oracle for `fn_cost_to_client_factor` (02-lld.md §5.3): falls back
 * phase -> package -> 1.0. A factor of 1.0 means "no margin data, bill at
 * cost" — visibly wrong on screen, which is safer than silently inventing one.
 */
export function costToClientFactor(
  phase?: { allocatedAmount: number; internalAmount: number } | null,
  pkg?: { allocatedAmount: number; internalAmount: number } | null
): number {
  if (phase && phase.internalAmount > 0) return phase.allocatedAmount / phase.internalAmount;
  if (pkg && pkg.internalAmount > 0) return pkg.allocatedAmount / pkg.internalAmount;
  return 1.0;
}
