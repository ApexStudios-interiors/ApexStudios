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

/**
 * D55 — per-project Rate visibility for Site Supervisors.
 *
 * AGENTS.md's headline rule is that a Site Supervisor sees no money. This is
 * the one explicit, per-project exception, and it defaults to `hidden`, so a
 * project behaves exactly as before until an owner/admin switches it on.
 *
 *   hidden    the Rate field is not rendered for site; a submitted rate is
 *             discarded server-side
 *   readonly  site sees the field, disabled; a submitted rate is still
 *             discarded
 *   editable  site may enter a rate and it is stored
 *
 * Owner/admin are unaffected by all three: they always see and edit Rate.
 */
export const RATE_VISIBILITY_MODES = ["hidden", "readonly", "editable"] as const;
export type RateVisibility = (typeof RATE_VISIBILITY_MODES)[number];

export const RATE_VISIBILITY_LABEL: Record<RateVisibility, string> = {
  hidden: "Hidden",
  readonly: "Visible, not editable",
  editable: "Visible and editable",
};

/** The column is `text` with a check constraint, so it arrives typed as
 *  `string`. Anything unrecognised falls back to the safe mode rather than
 *  being trusted — a value outside the three can only mean the database and
 *  this file have drifted, and `hidden` is the answer that leaks nothing. */
export function parseRateVisibility(value: string | null | undefined): RateVisibility {
  return (RATE_VISIBILITY_MODES as readonly string[]).includes(value ?? "")
    ? (value as RateVisibility)
    : "hidden";
}

/** Whether a site supervisor may STORE a rate on a request for this project.
 *  The one rule behind both the form and the server action — never re-decided
 *  at either call site. */
export function siteMayEnterRate(mode: RateVisibility): boolean {
  return mode === "editable";
}

/** Whether the Rate field is rendered at all for a site supervisor. */
export function siteMaySeeRateField(mode: RateVisibility): boolean {
  return mode === "readonly" || mode === "editable";
}

// ── New Project field validation ─────────────────────────────────────────────
// Pure, so the form and the Server Action apply exactly the same rules — the
// action is the boundary, the form is only the convenience.

/** Location is free text (an Indian site address has no fixed shape), so the
 *  check is deliberately light: it exists only to reject a value that is
 *  plainly not a place. */
export const LOCATION_MAX_LENGTH = 200;

/** At least one letter, in any script — "Ghanpur, Hyderabad" passes,
 *  "98765456789" does not. Empty stays legal: Location is optional. */
export function isValidLocation(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (trimmed.length > LOCATION_MAX_LENGTH) return false;
  return /\p{L}/u.test(trimmed);
}

export const PACKAGE_NAME_MAX_LENGTH = 60;

/** Letters, numbers, spaces and `& - . /` — enough for "MEP & HVAC" and
 *  "Block-A / Tower 2", and nothing else. The name ends up in a project's
 *  package list and in exports, so punctuation soup is rejected rather than
 *  stored. Applied to the already-trimmed name. */
const PACKAGE_NAME_ALLOWED = /^[\p{L}\p{N} &\-./]+$/u;

export function isValidPackageName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= 1 && trimmed.length <= PACKAGE_NAME_MAX_LENGTH && PACKAGE_NAME_ALLOWED.test(trimmed)
  );
}

/**
 * The package names a submission actually creates: each trimmed, blanks
 * dropped, and duplicates within the one submission dropped case-insensitively
 * (the first spelling wins). Validation is separate — this only normalises.
 */
export function normalisePackageNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Whether two project names are "the same name" for the duplicate warning —
 *  case- and surrounding-whitespace-insensitive. A warning only: a duplicate
 *  name is allowed (the code is auto-uniqued), so this is never a reason to
 *  reject a write. */
export function isSameProjectName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
