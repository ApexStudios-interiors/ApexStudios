import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireProjectAccess, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { setTaskProgressSchema } from "@/features/schedule/schema";
import { setTaskProgressFor } from "@/features/schedule/progress";

/**
 * PATCH /api/mobile/v1/projects/:projectId/packages/:packageId/schedule/tasks/:taskId
 * — set one schedule task's progress. The mobile counterpart of the web's
 * `setTaskProgress` action (features/schedule/actions.ts, the slider in
 * TaskDetailDialog): same schema, same shared helper
 * (features/schedule/progress.ts), so web and mobile behave identically.
 *
 *   body: { "progressPct": 0…100 }   — a whole number, as the web's schema
 *
 * Only `progressPct` is read from the body; the task, its package and its
 * project are the URL's. The task must be that package's and that project's
 * (else 404, before anything is written).
 *
 * Bearer only (no cookie); admin/site — the web action's roles (client →
 * 403); project access (non-member → 403). rpc_set_task_progress decides
 * again and does the rest: 0–100, the phase's billing status, the audit, the
 * package/project rollup. Returns `{ id, progressPct }`.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. Same table as the other mobile mutations. */
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; packageId: string; taskId: string }> }
) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const { projectId, packageId, taskId } = await params;
    // Not an id at all: the same answer as a record that does not exist.
    if (!isUuid(projectId) || !isUuid(packageId) || !isUuid(taskId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }
    // Admin passes implicitly; site needs a project_members row (403).
    await requireProjectAccess(session, projectId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // The task is the URL's; only the progress comes from the body, checked
    // by setTaskProgressSchema — the web action's own schema.
    const { progressPct } = body as { progressPct?: unknown };
    const parsed = setTaskProgressSchema.safeParse({ id: taskId, progressPct });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const task = await setTaskProgressFor(session, parsed.data, { projectId, packageId });
    return NextResponse.json({ id: task.id, progressPct: task.progressPct }, { headers: NO_STORE });
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
