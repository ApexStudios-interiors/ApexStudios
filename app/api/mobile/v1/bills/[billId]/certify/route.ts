import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileError } from "@/lib/mobile/api";
import { isUuid } from "@/lib/routing/slug";
import { env } from "@/lib/env";
import { transitionBillSchema } from "@/features/billing/schema";
import { transitionBillFor } from "@/features/billing/transition";
import {
  billErrorFrom,
  billUnavailable,
  billingUnavailable,
  requireBillDecisionSession,
} from "@/features/billing/mobile";

/**
 * POST /api/mobile/v1/bills/:billId/certify — a client certifies (on the
 * web: "Approve") a submitted bill. The mobile counterpart of the web's
 * `certifyBill` action (features/billing/actions.ts): the same guard (client
 * only), the same schema (transitionBillSchema, toStatus "certified"), the
 * same shared helper (features/billing/transition.ts → rpc_transition_bill).
 * No body is needed; any body is ignored.
 *
 * Bearer only (lib/mobile/api.ts): a browser's session cookie can never
 * authorize it. Off while BILLING_ENABLED is off (404, as the mobile read
 * routes). Every real rule is the RPC's: the bill must exist (NOT_FOUND,
 * 404), the caller must be a member of its project (FORBIDDEN, 403) and a
 * client (403), and only submitted -> certified is legal (else
 * ILLEGAL_TRANSITION, 409 — e.g. already decided). The answer is
 * `{ id, status }` only — never the row, so no internal figure. No web cache
 * refresh is copied.
 */
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const session = await requireBillDecisionSession();
    if (!env.BILLING_ENABLED) return billingUnavailable();

    const { billId } = await params;
    if (!isUuid(billId)) return billUnavailable();

    const parsed = transitionBillSchema.safeParse({ billId, toStatus: "certified" });
    if (!parsed.success) {
      return mobileError(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const moved = await transitionBillFor(session, parsed.data);
    return NextResponse.json({ id: moved.id, status: moved.status }, { headers: NO_STORE });
  } catch (e) {
    return billErrorFrom(e);
  }
}
