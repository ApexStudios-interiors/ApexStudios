import type { Role } from "@/lib/rbac/roles";

/**
 * build/07-stock-inventory-notifications.md §2.5. Pure — no `next/*`, no
 * `server-only` (code-standards §1). `rpc_transition_stock_request` is the
 * real enforcement (a UI button existing or not changes nothing at the
 * database); this exists so the row and the per-status button set are
 * derived from the exact same rule instead of two hand-kept lists that can
 * drift — "Do not implement transitions in the UI" (build §5) is about the
 * DECISION, not about being unable to describe what the RPC would allow.
 */
export type StockRequestStatus = "pending" | "approved" | "ordered" | "delivered" | "rejected" | "cancelled";

export type StockTransition = { to: Exclude<StockRequestStatus, "pending">; label: string };

const isAdminRole = (role: Role) => role === "admin";

/** What a caller knows about the row beyond its status. `isRequester` is
 *  whether the signed-in user raised it (the only person who may cancel it
 *  while it is still pending — 20261124400002). Optional, so every existing
 *  caller keeps its answer. */
export type TransitionContext = { isRequester?: boolean };

/**
 * The buttons a row offers. Mirrors rpc_transition_stock_request
 * (20261124400002) exactly:
 *   pending  → approved, rejected   admin
 *   pending  → cancelled            the requester (any role that may raise one)
 *   approved → ordered, cancelled   admin (cancel needs a reason)
 *   ordered  → delivered            admin or site
 *   ordered  → cancelled            admin (with a reason)
 *   delivered, rejected, cancelled  terminal
 */
export function availableTransitions(
  status: StockRequestStatus,
  role: Role,
  ctx: TransitionContext = {}
): StockTransition[] {
  const cancel: StockTransition = { to: "cancelled", label: "Cancel" };
  switch (status) {
    case "pending": {
      const out: StockTransition[] = isAdminRole(role)
        ? [
            { to: "approved", label: "Approve" },
            { to: "rejected", label: "Reject" },
          ]
        : [];
      if (ctx.isRequester && (isAdminRole(role) || role === "site")) out.push(cancel);
      return out;
    }
    case "approved":
      return isAdminRole(role) ? [{ to: "ordered", label: "Mark Ordered" }, cancel] : [];
    case "ordered":
      if (isAdminRole(role)) return [{ to: "delivered", label: "Mark Delivered" }, cancel];
      return role === "site" ? [{ to: "delivered", label: "Mark Delivered" }] : [];
    case "delivered":
    case "rejected":
    case "cancelled":
      // Terminal states are terminal (02-lld.md §5.4) — nothing to offer.
      return [];
  }
}

/** Cancelling a request an admin has already acted on needs a reason; the
 *  requester withdrawing their own pending request does not. */
export function cancelNeedsReason(status: StockRequestStatus): boolean {
  return status === "approved" || status === "ordered";
}

/** rpc_edit_stock_request: pending only, by the requester or an admin. */
export function canEditRequest(status: StockRequestStatus, role: Role, isRequester: boolean): boolean {
  if (status !== "pending") return false;
  return isAdminRole(role) || (role === "site" && isRequester);
}

/** rpc_set_stock_request_rate: admin, until the material is delivered. */
export function canSetRate(status: StockRequestStatus, role: Role): boolean {
  return isAdminRole(role) && (status === "pending" || status === "approved" || status === "ordered");
}

/**
 * A partial delivery's split (rpc_transition_stock_request, APX-69): how much
 * is delivered now, and how much stays Ordered as a new linked request.
 * `delivered` omitted means the whole request. Returns null when the
 * quantity is not one the RPC would accept (zero, negative, or more than was
 * ordered) — the form shows its own message for that.
 */
export function splitDelivery(
  ordered: number,
  delivered?: number | null
): { delivered: number; remainder: number } | null {
  if (delivered == null) return { delivered: ordered, remainder: 0 };
  if (!Number.isFinite(delivered) || delivered <= 0 || delivered > ordered) return null;
  // Quantities are numeric(14,3): keep the remainder to three places so 10 − 6.1
  // does not read 3.9000000000000004.
  return { delivered, remainder: Math.round((ordered - delivered) * 1000) / 1000 };
}

/** An existing inventory item the New Request form can link to. */
export type MaterialOption = { id: string; name: string; unit: string };

/**
 * APX-15: the inventory item a typed material refers to, or undefined for a
 * new material. Matched on the same normal form the delivery RPC uses
 * (`normalizeMaterialName` = public.fn_normalize_material_name) and — when a
 * unit is chosen — the unit too, because 50 bags and 50 kg of cement are not
 * the same stock line. With no unit chosen yet, a name that resolves to exactly
 * one item still matches (the form then fills in that item's unit).
 */
export function resolveMaterialOption(
  materialName: string,
  unit: string | undefined,
  options: readonly MaterialOption[]
): MaterialOption | undefined {
  const name = normalizeMaterialName(materialName);
  if (!name) return undefined;
  const byName = options.filter((o) => normalizeMaterialName(o.name) === name);
  if (unit) return byName.find((o) => o.unit === unit);
  return byName.length === 1 ? byName[0] : undefined;
}

// ── Deadlines ────────────────────────────────────────────────────────────────

/**
 * Business days here are **Monday–Friday**.
 *
 * There is NO public-holiday calendar in this system — no table, no feed and
 * no per-state list — so a national, state or local holiday is NOT skipped: a
 * request due the day after Diwali counts the holiday as a working day. That
 * is a deliberate limitation, not an oversight; adding a holiday calendar is a
 * schema change and an owner decision, not something to infer here.
 */
const SATURDAY = 6;
const SUNDAY = 0;

function isoToUtc(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [, y, m, d] = match;
  // Date.UTC, not the local constructor and never `new Date("yyyy-MM-dd")`:
  // this is pure calendar arithmetic on a date-only value, so it must not be
  // able to drift with the host's timezone or a DST transition. It is
  // formatted back by hand below — `toISOString()` is banned in this codebase
  // for exactly the reason it would be wrong here.
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcToIso(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * `isoDate` moved back `days` business days (Mon–Fri), as `yyyy-MM-dd`.
 *
 * It counts business days crossed, so the start date's own weekday matters:
 * two business days before a Monday is the Thursday before it, and two before
 * a Saturday is the preceding Thursday as well. Returns the input unchanged
 * when it is not a `yyyy-MM-dd` date, or when `days` is zero or negative.
 */
export function subtractBusinessDays(isoDate: string, days: number): string {
  const date = isoToUtc(isoDate);
  if (!date || days <= 0) return isoDate;
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const day = date.getUTCDay();
    if (day !== SATURDAY && day !== SUNDAY) remaining -= 1;
  }
  return utcToIso(date);
}

/** How far ahead of its needed-by date a still-pending request starts reading
 *  as at risk. Owner decision: two business days. */
export const DEADLINE_WARNING_BUSINESS_DAYS = 2;

/**
 * Whether a request's needed-by date should read as overdue or at risk — the
 * one rule behind the red date in the stock list.
 *
 * True only while the request is still **pending** approval (an approved,
 * ordered, delivered or rejected request has moved on, and its deadline is no
 * longer a call to action), from two business days before the date onwards,
 * and it stays true once the date has passed.
 *
 * `today` is passed in as `yyyy-MM-dd` — `todayIst()` from `lib/dates` at
 * every call site. This function never asks the host what day it is.
 */
export function isDeadlineAtRisk(
  status: StockRequestStatus,
  neededBy: string | null | undefined,
  today: string
): boolean {
  if (status !== "pending" || !neededBy) return false;
  if (!isoToUtc(neededBy) || !isoToUtc(today)) return false;
  // String comparison is correct for zero-padded yyyy-MM-dd, and is the same
  // ordering the database applies to a `date` column.
  return today >= subtractBusinessDays(neededBy, DEADLINE_WARNING_BUSINESS_DAYS);
}

// ── Duplicate detection ──────────────────────────────────────────────────────

/** The fields a duplicate is decided on. */
export type DuplicateCandidate = {
  /** Set when the request is linked to a real inventory item. */
  inventoryItemId?: string | null;
  materialName: string;
  qty: number;
  neededBy?: string | null;
};

/** Trimmed, case-folded, and inner runs of whitespace collapsed — the shape
 *  both sides of a name comparison are put into. */
export function normalizeMaterialName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether an already-**delivered** request is "the same order" as the one
 * being raised. A warning only: the caller still submits, and nothing in the
 * workflow changes.
 *
 * The rule, in full:
 *   - same quantity, exactly — no tolerance, because 100 bags and 100.5 bags
 *     are different orders;
 *   - same needed-by date, and BOTH must have one. Two requests with no
 *     deadline are not evidence of a repeat, so a null on either side never
 *     matches;
 *   - same material, decided by the linked `inventory_item_id` when the NEW
 *     request has one, because that is an identity rather than a spelling;
 *     otherwise by the material name, trimmed, whitespace-collapsed and
 *     compared case-insensitively ("Cement OPC 53" = " cement  opc 53"). The
 *     form's material field is free text with a suggestion list, so the same
 *     material is routinely typed with different capitalisation and spacing.
 *
 * Deliberately NOT fuzzy: no stemming, no edit distance, no unit conversion.
 * A false warning on a genuine second order is worse than a missed one,
 * because the warning is advisory and a noisy advisory gets ignored.
 */
export function isDuplicateOfDelivered(candidate: DuplicateCandidate, existing: DuplicateCandidate): boolean {
  if (candidate.qty !== existing.qty) return false;
  if (!candidate.neededBy || !existing.neededBy) return false;
  if (candidate.neededBy !== existing.neededBy) return false;

  if (candidate.inventoryItemId) return candidate.inventoryItemId === existing.inventoryItemId;
  return normalizeMaterialName(candidate.materialName) === normalizeMaterialName(existing.materialName);
}

/** The copy the form shows. One string, so the dialog and its test agree. */
export const DUPLICATE_DELIVERED_WARNING =
  "This order has already been delivered with the mentioned quantity and deadline date.";
