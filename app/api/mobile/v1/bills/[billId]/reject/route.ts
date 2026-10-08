import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileError } from "@/lib/mobile/api";
import { isUuid } from "@/lib/routing/slug";
import { env } from "@/lib/env";
import { rejectBillSchema } from "@/features/billing/schema";
import { transitionBillFor } from "@/features/billing/transition";
import {
  billErrorFrom,
  billUnavailable,
  billingUnavailable,
  requireBillDecisionSession,
} from "@/features/billing/mobile";

/**
 * POST /api/mobile/v1/bills/:billId/reject — a client rejects a submitted
 * bill, with a reason; the bill returns to draft with its revision raised.
 * The mobile counterpart of the web's `rejectBill` action
 * (features/billing/actions.ts): the same guard (client only), the same
 * schema (rejectBillSchema — the reason trimmed, then required: "Please give
 * a reason"), the same shared helper (features/billing/transition.ts →
 * rpc_transition_bill, toStatus "draft", the reason as its note).
 *
 *   body: { "reason": string }
 *
 * Bearer only (lib/mobile/api.ts). Off while BILLING_ENABLED is off (404).
 * Every real rule is the RPC's: the bill must exist (404), the caller must
 * be a member of its project (403) and a client (403), only submitted ->
 * draft is legal (else ILLEGAL_TRANSITION, 409), and the reason is required
 * there too (REASON_REQUIRED, 422). The answer is `{ id, status }` only. No
 * web cache refresh is copied.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const session = await requireBillDecisionSession();
    if (!env.BILLING_ENABLED) return billingUnavailable();

    const { billId } = await params;
    if (!isUuid(billId)) return billUnavailable();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mobileError(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return mobileError(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // The URL's id joins the body, so rejectBillSchema — the web action's
    // own schema — stays the single source of truth for the reason. A missing
    // reason is an empty one, so it gets the schema's own "Please give a
    // reason" rather than a type error; any other non-string is still refused.
    const { reason } = body as { reason?: unknown };
    const parsed = rejectBillSchema.safeParse({ billId, reason: reason ?? "" });
    if (!parsed.success) {
      return mobileError(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const moved = await transitionBillFor(session, {
      billId: parsed.data.billId,
      toStatus: "draft",
      note: parsed.data.reason,
    });
    return NextResponse.json({ id: moved.id, status: moved.status }, { headers: NO_STORE });
  } catch (e) {
    return billErrorFrom(e);
  }
}
