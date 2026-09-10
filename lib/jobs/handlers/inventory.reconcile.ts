import "server-only";

/**
 * Build 07 fills this in: recompute `qty_on_hand` from `stock_movements`,
 * alert on drift (01-hld.md §10.2). The cron entry, the registry wiring and
 * the Admin ops page all ship now, per build/06-files-jobs-daily-updates.md's
 * own deliverables list, so nothing in that chain has to change the day this
 * handler grows real logic. A safe no-op in the meantime — not a crash the
 * nightly cron would report as a failed job every single night.
 */
export async function reconcileInventory(): Promise<void> {
  // TODO(build-07): recompute qty_on_hand from stock_movements; alert on drift.
}
