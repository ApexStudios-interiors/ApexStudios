import { Decimal } from "decimal.js";

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

// ── Project membership: client access and the site team (D51, APX-12) ───────

/** The two roles whose project access is a membership row. Admins are
 *  implicit members of every project in the org (02-lld.md §3.2) and have no
 *  rows to add or remove. */
export type MemberRole = "client" | "site";

/**
 * Why taking a profile off a project is refused, or null if it may go ahead.
 * Pure, so the Client access card, the Site team card, the Users page and
 * removeProjectMember all apply the same rule. Generalised on 2026-11-24 from
 * the client-only rule of PRs #89/#90, so a Site Supervisor can be taken off
 * a project too.
 *
 * - `implicit_member`: an admin sees every project without a membership row;
 *   there is nothing to remove.
 * - `wrong_role`: the screen manages one role (`expectedRole`) and the
 *   profile has another — the Client access card never removes a supervisor.
 * - `not_member`: nothing to remove.
 *
 * A member's LAST project may be removed too (owner decision, 2026-11-23): the
 * login stays and can sign in, but sees no project until given one again, or
 * Deactivate ends it. The confirm step says so (lastProjectRemovalNote).
 */
export type MemberRemovalRefusal = "implicit_member" | "not_member" | "wrong_role";

export function memberRemovalRefusal(target: {
  role: string;
  isMember: boolean;
  expectedRole?: MemberRole;
}): MemberRemovalRefusal | null {
  if (target.role !== "client" && target.role !== "site") return "implicit_member";
  if (target.expectedRole && target.role !== target.expectedRole) return "wrong_role";
  if (!target.isMember) return "not_member";
  return null;
}

export const MEMBER_REMOVAL_REFUSAL_COPY: Record<MemberRemovalRefusal, string> = {
  implicit_member: "Admins see every project; there is no access to remove.",
  not_member: "They already can't see this project.",
  wrong_role: "That login has a different role; manage it on its own card.",
};

/**
 * Why giving a profile access to a project is refused, or null. Same roles
 * as removal: an admin needs no row, and a card that grants one role (Site
 * team, Client access) refuses the other.
 */
export type MemberGrantRefusal = "implicit_member" | "wrong_role";

export function memberGrantRefusal(target: {
  role: string;
  expectedRole?: MemberRole;
}): MemberGrantRefusal | null {
  if (target.role !== "client" && target.role !== "site") return "implicit_member";
  if (target.expectedRole && target.role !== target.expectedRole) return "wrong_role";
  return null;
}

export const MEMBER_GRANT_REFUSAL_COPY: Record<MemberGrantRefusal, string> = {
  implicit_member: "Admins already see every project.",
  wrong_role: "That login has a different role; add it on its own card.",
};

/** Shown when confirming the removal of a client's only project. */
export const CLIENT_LAST_PROJECT_REMOVAL_NOTE =
  "This is their only project: they can still sign in but will see no projects until you give them access to one again (Add existing client) or deactivate them on the Users page.";

/** Shown when confirming the removal of a site supervisor's only project. */
export const SITE_LAST_PROJECT_REMOVAL_NOTE =
  "This is their only project: they can still sign in but will see no projects until you add them to one again (Site team, or Projects on the Users page) or deactivate them.";

export function lastProjectRemovalNote(role: MemberRole): string {
  return role === "client" ? CLIENT_LAST_PROJECT_REMOVAL_NOTE : SITE_LAST_PROJECT_REMOVAL_NOTE;
}

// ── Project status lifecycle (APX-11) ────────────────────────────────────────

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * The legal next statuses from each status. The TypeScript copy of
 * `fn_project_status_transition_allowed` (migration 20261124300000): the
 * status control offers only these, and pgTAP asserts the SQL matrix lists
 * exactly the same eight pairs. rpc_set_project_status is the boundary.
 */
export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  planning: ["active"],
  active: ["on_hold", "completed"],
  on_hold: ["active", "completed"],
  completed: ["archived", "active"],
  archived: ["completed"],
};

export function parseProjectStatus(value: string | null | undefined): ProjectStatus | null {
  return (PROJECT_STATUSES as readonly string[]).includes(value ?? "") ? (value as ProjectStatus) : null;
}

export function isProjectStatusTransitionAllowed(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[from].includes(to);
}

/** Walking back from a finished state. Needs a reason, which is audited. */
export function isProjectReopen(from: ProjectStatus, to: ProjectStatus): boolean {
  return (from === "completed" && to === "active") || (from === "archived" && to === "completed");
}

/** What moving to each status means — one line, shown under the choice. */
export const PROJECT_STATUS_MOVE_HINT: Record<ProjectStatus, string> = {
  planning: "Not started yet.",
  active: "Work is under way.",
  on_hold: "Paused. Everything still works; it reads On Hold everywhere.",
  completed:
    "Finished. No new stock requests or daily updates; billing and payments carry on. Archived automatically 12 months later.",
  archived: "Read-only: nothing on the project can change except billing and payments.",
};

// ── Read-only projects (APX-41) ──────────────────────────────────────────────

/**
 * What a write is, for the read-only rule. `edit` is everything except the
 * two kinds a completed project refuses on top of what an archived one does.
 */
export type ProjectWriteKind = "edit" | "stock_request" | "daily_update";

export const PROJECT_ARCHIVED_COPY = "This project is archived, so it is read-only.";
export const PROJECT_COMPLETED_COPY =
  "This project is completed, so no new stock requests or daily updates can be added.";

/**
 * Why a write of `kind` is refused on a project in `status`, as the sentence
 * shown with the disabled button, or null. Mirrors trg_project_writable
 * (migration 20261124300001), which is the boundary; this only keeps the
 * buttons honest.
 *
 *   archived   every kind refused
 *   completed  a new stock request or daily update refused; the rest allowed
 */
export function projectWriteRefusal(
  status: string | null | undefined,
  kind: ProjectWriteKind
): string | null {
  if (status === "archived") return PROJECT_ARCHIVED_COPY;
  if (status === "completed" && (kind === "stock_request" || kind === "daily_update")) {
    return PROJECT_COMPLETED_COPY;
  }
  return null;
}

// ── Edit Project validation (APX-11) ─────────────────────────────────────────

/** A percentage as the projects table stores it: numeric(6,3), 0–100. */
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,3})?$/;

export function isValidPercent(value: string): boolean {
  const trimmed = value.trim();
  return PERCENT_PATTERN.test(trimmed) && Number(trimmed) <= 100;
}

/** yyyy-MM-dd strings compare correctly as strings — no Date parsing (AGENTS.md). */
export function targetEndDateRefusal(startDate: string, targetEndDate: string | null): string | null {
  if (!targetEndDate) return null;
  return targetEndDate < startDate ? "Target end date can't be before the start date." : null;
}

/** projects_mobilisation_ck: the advance can never fall below what has
 *  already been recovered on bills. Compared as decimals, never floats. */
export function mobilisationAdvanceRefusal(advance: string, recovered: string | number): string | null {
  return new Decimal(advance.trim()).lessThan(new Decimal(recovered))
    ? "Mobilisation advance can't be less than what has already been recovered on bills."
    : null;
}

export type ProjectEditRefusal = {
  field: "form" | "targetEndDate" | "mobilisationAdvance";
  message: string;
};

/**
 * The checks an edit needs the CURRENT row for, which a zod schema cannot
 * see: an archived project is read-only, the target end date may not precede
 * the start date (projects_dates_ck), and the mobilisation advance may not
 * drop below what bills have already recovered (projects_mobilisation_ck).
 * Each comes back on the field it concerns, so the dialog shows it inline
 * instead of the database's constraint error.
 */
export function projectEditRefusal(
  current: { status: string; startDate: string; mobilisationRecovered: string | number },
  patch: { targetEndDate?: string | null; mobilisationAdvance?: string }
): ProjectEditRefusal | null {
  if (current.status === "archived") return { field: "form", message: PROJECT_ARCHIVED_COPY };
  if (patch.targetEndDate) {
    const message = targetEndDateRefusal(current.startDate, patch.targetEndDate);
    if (message) return { field: "targetEndDate", message };
  }
  if (patch.mobilisationAdvance !== undefined) {
    const message = mobilisationAdvanceRefusal(patch.mobilisationAdvance, current.mobilisationRecovered);
    if (message) return { field: "mobilisationAdvance", message };
  }
  return null;
}

// ── Setup checklist (APX-70) ─────────────────────────────────────────────────

export type SetupFacts = {
  status: string;
  packages: { id: string; seqNo: number; name: string; allocated: number; phases: number; tasks: number }[];
  siteMembers: number;
  clientMembers: number;
};

export type SetupTarget =
  | { kind: "addPackage" }
  | { kind: "package"; packageId: string; tab: "budget" | "schedule" }
  | { kind: "siteTeam" }
  | { kind: "clientAccess" }
  | { kind: "status" };

export type SetupItemKey = "packages" | "phases" | "tasks" | "site" | "client" | "active";

export type SetupItem = {
  key: SetupItemKey;
  label: string;
  done: boolean;
  /** What is missing, when not done. */
  detail: string | null;
  target: SetupTarget;
};

type SetupPackage = SetupFacts["packages"][number];

function missingIn(list: SetupPackage[], what: string): string {
  return list.length === 1
    ? `${list[0]?.name ?? "One package"} has no ${what}.`
    : `${list.length} packages have no ${what}.`;
}

/** The first package still missing something, as a link target. */
function packageTarget(list: SetupPackage[], tab: "budget" | "schedule"): SetupTarget {
  const first = list[0];
  return first ? { kind: "package", packageId: first.id, tab } : { kind: "addPackage" };
}

/**
 * The setup checklist on a new project's dashboard, in the order the work
 * has to happen: packages with budgets → phases → tasks → site supervisor →
 * client access → Active. Each item says what is missing and points at where
 * to fix it; for a package-level item that is the FIRST package (by number)
 * still missing it.
 */
export function setupChecklist(facts: SetupFacts): SetupItem[] {
  const pkgs = [...facts.packages].sort((a, b) => a.seqNo - b.seqNo);
  const none = pkgs.length === 0;
  const unbudgeted = pkgs.filter((p) => p.allocated <= 0);
  const noPhases = pkgs.filter((p) => p.phases === 0);
  const noTasks = pkgs.filter((p) => p.tasks === 0);

  return [
    {
      key: "packages",
      label: "Packages with budgets",
      done: !none && unbudgeted.length === 0,
      detail: none ? "No packages yet." : unbudgeted.length ? missingIn(unbudgeted, "budget") : null,
      target: packageTarget(unbudgeted, "budget"),
    },
    {
      key: "phases",
      label: "Phases in every package",
      done: !none && noPhases.length === 0,
      detail: none ? "Add a package first." : noPhases.length ? missingIn(noPhases, "phases") : null,
      target: packageTarget(noPhases, "budget"),
    },
    {
      key: "tasks",
      label: "A schedule in every package",
      done: !none && noTasks.length === 0,
      detail: none ? "Add a package first." : noTasks.length ? missingIn(noTasks, "tasks") : null,
      target: packageTarget(noTasks, "schedule"),
    },
    {
      key: "site",
      label: "A site supervisor",
      done: facts.siteMembers > 0,
      detail: facts.siteMembers > 0 ? null : "No supervisor can see this project yet.",
      target: { kind: "siteTeam" },
    },
    {
      key: "client",
      label: "Client access",
      done: facts.clientMembers > 0,
      detail: facts.clientMembers > 0 ? null : "No client can sign in to see it yet.",
      target: { kind: "clientAccess" },
    },
    {
      key: "active",
      label: "Status set to Active",
      done: facts.status !== "planning",
      detail: facts.status === "planning" ? "Still Planning." : null,
      target: { kind: "status" },
    },
  ];
}

/**
 * Whether the checklist card shows at all: only while something is left to
 * do, and never on a finished project (completed or archived), where an
 * empty schedule is history rather than a setup gap.
 */
export function showSetupChecklist(facts: SetupFacts): boolean {
  if (facts.status === "completed" || facts.status === "archived") return false;
  return setupChecklist(facts).some((item) => !item.done);
}
