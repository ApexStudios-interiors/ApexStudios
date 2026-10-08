import "server-only";
import { ForbiddenError, type Session } from "@/lib/auth/session";
import { CAN } from "@/lib/rbac/permissions";
import type { Role } from "@/lib/rbac/roles";
import { mobileError, mobileErrorFrom, requireBearerSession } from "@/lib/mobile/api";
import { codeFromPostgresMessage } from "@/lib/safe-action";
import type { BillDTO, BillLineDTO } from "./queries";

/**
 * The mobile Billing API's shared pieces (app/api/mobile/v1/projects/
 * :projectId/bills/**): who may read Billing, and which of the web's own
 * DTO fields go to the phone. Nothing here queries or computes — every row
 * and figure is the web query's own (features/billing/queries.ts), passed
 * through as-is.
 */

export type BillingRole = "admin" | "client";

/** The web's own `viewBilling` list — admin and client. */
const BILLING_ROLES: readonly Role[] = CAN.viewBilling;

/**
 * The Bearer session, for a user the web lets view Billing — `viewBilling`
 * (lib/rbac/permissions.ts: admin, client), exactly as the web's
 * `getBillDetailForDialog` gates it (`requireRole(["admin", "client"])`).
 * Site is refused (403), never served the client-shaped branch.
 *
 * The data's shape follows the EFFECTIVE role, as the web Billing page and
 * `getBillDetail` both branch on it; a site preview is refused like the
 * page's own `forbidden()`. (A phone sends no preview cookie, so for it the
 * effective role is the real one.)
 */
export async function requireBillingSession(): Promise<{ session: Session; role: BillingRole }> {
  // requireRole's own check (the REAL role), on the one Bearer-verified
  // session rather than verifying the token a second time.
  const session = await requireBearerSession();
  if (!BILLING_ROLES.includes(session.role)) {
    throw new ForbiddenError(`requires one of: ${BILLING_ROLES.join(", ")}`);
  }
  const effective = session.impersonating?.role ?? session.role;
  if (effective !== "admin" && effective !== "client") {
    throw new ForbiddenError("billing is admin and client only");
  }
  return { session, role: effective };
}

/**
 * The Bearer session, for a user who may decide (certify or reject) a bill:
 * a client — the web's `clientAction` guard on `certifyBill`/`rejectBill`
 * (`requireRole(["client"])`, the REAL role), on the one Bearer-verified
 * session. Admin and site are 403 here; `rpc_transition_bill` refuses them
 * again regardless.
 */
export async function requireBillDecisionSession(): Promise<Session> {
  const session = await requireBearerSession();
  if (session.role !== "client") throw new ForbiddenError("requires one of: client");
  return session;
}

// ── 404 wording ──────────────────────────────────────────────────────────────
//
// Still 404 / NOT_FOUND, as before; only the words are specific. Two answers,
// and no more:
//
//  - Billing switched off (BILLING_ENABLED) — one setting for everyone, only
//    ever answered after sign-in and the Billing role check, so saying so
//    reveals nothing about any project or bill.
//  - A bill that is not available — ONE answer for every reason a bill is not
//    shown: no such id, soft-deleted, of another project, a draft to a
//    client, or an id that is not even well-formed. They must stay
//    indistinguishable, so none of them says why.

export const BILLING_UNAVAILABLE_MESSAGE = "Billing isn't available yet.";
export const BILL_UNAVAILABLE_MESSAGE = "This bill isn't available.";

/** BILLING_ENABLED is off. */
export function billingUnavailable() {
  return mobileError(404, "NOT_FOUND", BILLING_UNAVAILABLE_MESSAGE);
}

/** The bill is not available to this user, for whatever reason. */
export function billUnavailable() {
  return mobileError(404, "NOT_FOUND", BILL_UNAVAILABLE_MESSAGE);
}

/** A bill route's error: a domain NOT_FOUND (the transition RPC's own "bill
 *  does not exist") is the same single bill answer; everything else is the
 *  shared mobile mapping, unchanged. */
export function billErrorFrom(e: unknown) {
  if (e instanceof Error && codeFromPostgresMessage(e.message) === "NOT_FOUND") return billUnavailable();
  return mobileErrorFrom(e);
}

/** The admin-only internal block — keys present ONLY for an admin. The
 *  client's own DTO never carries them (v_bill_client omits the columns);
 *  this keeps an admin key from ever being copied onto a client response. */
function internal(bill: BillDTO, role: BillingRole) {
  return role === "admin"
    ? { internalCostAmount: bill.internalCostAmount ?? 0, marginAmount: bill.marginAmount ?? 0 }
    : {};
}

/** A row of the web Bills table (BillingAdmin / BillingClient): Bill, Date,
 *  Packages, Taxable, GST, Net Payable, Status, paid date — plus Margin for
 *  an admin. */
export function toMobileBillSummary(bill: BillDTO, role: BillingRole) {
  return {
    id: bill.id,
    refNo: bill.refNo,
    revision: bill.revision,
    billDate: bill.billDate,
    periodFrom: bill.periodFrom,
    periodTo: bill.periodTo,
    status: bill.status,
    packageLabels: bill.packageLabels,
    taxableAmount: bill.taxableAmount,
    gstAmount: bill.gstAmount,
    invoiceTotal: bill.invoiceTotal,
    netPayable: bill.netPayable,
    submittedAt: bill.submittedAt,
    certifiedAt: bill.certifiedAt,
    paidAt: bill.paidAt,
    ...internal(bill, role),
  };
}

/** The web bill dialog's own figures (BillViewDialog), in its order: Gross →
 *  less MAS recovery → Taxable → + GST = Invoice total → less retention, TDS,
 *  advance = Net payable; the certification fields; Internal for an admin. */
export function toMobileBillDetail(bill: BillDTO, role: BillingRole) {
  return {
    id: bill.id,
    projectId: bill.projectId,
    refNo: bill.refNo,
    revision: bill.revision,
    billDate: bill.billDate,
    periodFrom: bill.periodFrom,
    periodTo: bill.periodTo,
    status: bill.status,
    workValue: bill.workValue,
    materialValue: bill.materialValue,
    grossAmount: bill.grossAmount,
    masRecoveryAmount: bill.masRecoveryAmount,
    taxableAmount: bill.taxableAmount,
    gstRatePct: bill.gstRatePct,
    gstAmount: bill.gstAmount,
    invoiceTotal: bill.invoiceTotal,
    retentionPct: bill.retentionPct,
    retentionAmount: bill.retentionAmount,
    tdsPct: bill.tdsPct,
    tdsAmount: bill.tdsAmount,
    advanceRecovery: bill.advanceRecovery,
    netPayable: bill.netPayable,
    notes: bill.notes,
    createdAt: bill.createdAt,
    submittedAt: bill.submittedAt,
    certifiedAt: bill.certifiedAt,
    certificationNote: bill.certificationNote,
    paidAt: bill.paidAt,
    ...internal(bill, role),
  };
}

/** A bill line as the dialog's table shows it; `internalCost` admin only. */
export function toMobileBillLine(line: BillLineDTO, role: BillingRole) {
  return {
    id: line.id,
    sourceType: line.sourceType,
    description: line.description,
    clientValue: line.clientValue,
    pctBilled: line.pctBilled,
    amount: line.amount,
    ...(role === "admin" ? { internalCost: line.internalCost ?? 0 } : {}),
  };
}
