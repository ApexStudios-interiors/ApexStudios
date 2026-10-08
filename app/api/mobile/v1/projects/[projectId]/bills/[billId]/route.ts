import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileErrorFrom } from "@/lib/mobile/api";
import { requireProjectAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/routing/slug";
import { env } from "@/lib/env";
import { getBillDetail, getBillPaymentsSummary } from "@/features/billing/queries";
import { getBillPdfUrl } from "@/features/billing/actions";
import { billDecisionsFor } from "@/features/billing/decisions";
import {
  billUnavailable,
  billingUnavailable,
  requireBillingSession,
  toMobileBillDetail,
  toMobileBillLine,
} from "@/features/billing/mobile";

/**
 * GET /api/mobile/v1/projects/:projectId/bills/:billId — one bill: what the
 * web's bill dialog (BillViewDialog) shows, through the web's own helpers:
 *
 *  - getBillDetail — the bill, its lines and its bill-copy links, already
 *    role-shaped (admin: `bills`/`bill_lines` with cost and margin; client:
 *    `v_bill_client`/`v_bill_line_client`, which omit them);
 *  - getBillPdfUrl — the generated invoice PDF's short-lived presigned link
 *    (02-lld.md §7: "pdf: any member"), or null until the PDF job has run;
 *  - getBillPaymentsSummary — admin only, as `payments` itself is (the
 *    Record Payment dialog's "paid so far"); a client response has no
 *    `payments` key at all;
 *  - billDecisionsFor — `actions`, the decisions this user may make on the
 *    bill now (the web client's own rule: a client, on a submitted bill:
 *    certify and reject); always empty for an admin. The app offers exactly
 *    these; POST /api/mobile/v1/bills/:billId/certify|reject and the RPC
 *    behind them decide for real.
 *
 * Bearer only. Admin and client (`viewBilling`); site is 403. The project
 * must be the user's (403). The bill must belong to the URL's project — the
 * helpers look a bill up by id alone, so a bill of any other project is 404,
 * exactly like one that does not exist. A client never sees a draft (the web
 * client's bill list excludes them, getBillsPageForClient), so a draft is
 * 404 for a client too. Off entirely while `BILLING_ENABLED` is off (404).
 * Malformed ids are 404 before any read.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; billId: string }> }
) {
  try {
    const { role, session } = await requireBillingSession();
    if (!env.BILLING_ENABLED) return billingUnavailable();

    const { projectId, billId } = await params;
    if (!isUuid(projectId) || !isUuid(billId)) return billUnavailable();

    // Admin passes implicitly; a client needs a project_members row (403).
    await requireProjectAccess(session, projectId);

    const detail = await getBillDetail(session, billId);
    // Never trust the pairing the phone sent: the bill's own project decides.
    // Every reason a bill is not shown gets the same single answer.
    if (!detail || detail.bill.projectId !== projectId) return billUnavailable();
    if (role === "client" && detail.bill.status === "draft") return billUnavailable();

    const [pdfUrl, payments] = await Promise.all([
      getBillPdfUrl(billId),
      role === "admin" ? getBillPaymentsSummary(billId) : Promise.resolve(null),
    ]);

    return NextResponse.json(
      {
        // The role the data is shaped for — the only role the app branches on.
        role,
        bill: toMobileBillDetail(detail.bill, role),
        lines: detail.lines.map((l) => toMobileBillLine(l, role)),
        // Uploaded copies (and the generated PDF), each a presigned link.
        billCopies: detail.billCopyUrls.map((c) => ({ id: c.id, name: c.name, url: c.url })),
        pdfUrl,
        actions: billDecisionsFor(role, detail.bill.status),
        ...(payments
          ? {
              payments: {
                paidSoFar: payments.paidSoFar,
                items: payments.payments.map((p) => ({
                  id: p.id,
                  amount: p.amount,
                  paidOn: p.paidOn,
                  mode: p.mode,
                  referenceNo: p.referenceNo,
                })),
              },
            }
          : {}),
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    return mobileErrorFrom(e);
  }
}
