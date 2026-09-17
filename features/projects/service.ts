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

/** Words that carry no identity, so they earn no initial. */
const CODE_STOPWORDS = new Set(["A", "AN", "AND", "AT", "FOR", "IN", "OF", "ON", "THE", "TO"]);

/**
 * The BASE a project code is generated from: the first word of the name, then
 * the initials of the rest — 'BHEL Nagnar Club House' -> 'BHEL-NCH', which is
 * exactly the seeded project's code (D17's convention), and 'Model Villas
 * Interiors' -> 'MODEL-VI'.
 *
 * Not the final code. The database appends a numeric suffix when the base is
 * already used in the org, and re-normalises it to projects_code_ck's shape —
 * see migration 20260917100001 for why uniqueness cannot be decided here. The
 * client name is deliberately not part of it: the seeded example's client is
 * 'T V Rao Housing Pvt Ltd', and 'BHEL-NCH' contains none of it.
 */
export function projectCodeBase(projectName: string): string {
  const words = projectName
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const [first, ...rest] = words;
  if (!first) return "PRJ";

  const head = first.slice(0, 8);
  const initials = rest
    .filter((w) => !CODE_STOPWORDS.has(w))
    .map((w) => w.charAt(0))
    .join("")
    .slice(0, 6);
  const base = initials ? `${head}-${initials}` : head;
  return base.length < 3 ? base.padEnd(3, "X") : base;
}

// packageStatusLabel and phaseVariance live in features/packages/service.ts —
// that is the feature that owns packages and phases.
