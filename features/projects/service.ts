/**
 * Pure. No next/* imports — testable against a plain connection or no
 * connection at all (HLD §4.3, code-standards §1).
 */

/** Per-project billing constants. HLD §5.2: defaults only, never hard-coded
 *  into the arithmetic itself — every project row carries its own values. */
export const DEFAULT_BILLING_CONSTANTS = {
  gstRatePct: "18.000",
  retentionPct: "5.000",
  masBillablePct: "75.000",
  tdsPct: "0.000",
} as const;

/** project_status -> the prototype's display strings. The enum is the source
 *  of truth; this is a presentation concern, not a schema one. */
const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  archived: "Archived",
};

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABEL[status] ?? status;
}

// packageStatusLabel and phaseVariance live in features/packages/service.ts —
// that is the feature that owns packages and phases.
