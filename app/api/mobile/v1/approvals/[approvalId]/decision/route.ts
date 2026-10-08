import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { createClient, getBearerToken } from "@/lib/supabase/server";
import { decideApprovalSchema } from "@/features/approvals/schema";

/**
 * POST /api/mobile/v1/approvals/:approvalId/decision — a client approves or
 * rejects a pending approval. The mobile counterpart of the web's
 * `decideApproval` action (features/approvals/actions.ts), calling the same
 * `rpc_decide_approval`.
 *
 * Bearer only. createClient()/getSession() would also accept a browser's
 * session cookie, so this mutation refuses any request without an
 * `Authorization: Bearer` header first — a cookie can never authorize it.
 * middleware.ts skips /api/mobile/*, so the route is its own guard.
 *
 * Every rule that matters is the RPC's, under a row lock: the approval
 * exists, the caller is a client and a member of its project, it is still
 * pending, the decision is approve/reject, a rejection has a reason, and a
 * decision is final. requireRole(["client"]) here only gives admin/site a
 * clean 403 before the round trip, as the web action's clientAction does —
 * the RPC refuses them regardless. No web cache refresh (revalidatePath,
 * updateTag) is copied: nothing a mobile client reads is cached by Next.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  REASON_REQUIRED: 422,
};

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

/** The approvals row rpc_decide_approval returns — only the columns read here. */
type DecidedApprovalRow = {
  id: string;
  project_id: string;
  status: "approved" | "rejected";
  decided_at: string;
  decision_reason: string | null;
};

export async function POST(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; admin and site stop here (403).
    await requireRole(["client"]);

    const { approvalId } = await params;
    // Not an id at all: the same answer as an approval that does not exist.
    if (!isUuid(approvalId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // The URL's id joins the body so decideApprovalSchema — the web action's
    // own schema — stays the single source of truth for the input.
    const parsed = decideApprovalSchema.safeParse({ ...body, approvalId });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_decide_approval", {
      p_approval_id: parsed.data.approvalId,
      p_decision: parsed.data.decision,
      p_reason: parsed.data.reason,
    });
    if (error) throw new Error(error.message);
    // A `returns public.approvals` RPC is typed `unknown` by the generator —
    // the same cast the web action makes.
    const row = data as DecidedApprovalRow;

    return NextResponse.json(
      {
        approval: {
          id: row.id,
          projectId: row.project_id,
          status: row.status,
          decidedAt: row.decided_at,
          decisionReason: row.decision_reason,
        },
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code =
      err instanceof UnauthenticatedError
        ? "UNAUTHENTICATED"
        : err instanceof ForbiddenError
          ? "FORBIDDEN"
          : codeFromPostgresMessage(err.message);
    const status = code ? STATUS_BY_CODE[code] : undefined;
    // mapDomainError owns the user-facing copy (and logs an unmapped error
    // with the reference it returns); a raw database message never leaves.
    const message = mapDomainError(err);
    if (code && status) return errorResponse(status, code, message);
    return errorResponse(500, "INTERNAL", message);
  }
}
