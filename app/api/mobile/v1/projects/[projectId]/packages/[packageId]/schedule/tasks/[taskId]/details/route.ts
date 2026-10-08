import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileError, mobileErrorFrom, mobileNotFound } from "@/lib/mobile/api";
import { requireProjectAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/routing/slug";
import { updateTaskSchema } from "@/features/schedule/schema";
import { updateTaskFor } from "@/features/schedule/tasks";
import { requireTaskEditorSession } from "@/features/schedule/mobile";

/**
 * PATCH /api/mobile/v1/projects/:projectId/packages/:packageId/schedule/tasks/:taskId/details
 * — edit a task's plain fields. The mobile counterpart of the web's
 * `updateTask` action (features/schedule/actions.ts, TaskDetailDialog's
 * Save): the same guard (admin/site), the same schema (updateTaskSchema),
 * the same shared helper (features/schedule/tasks.ts).
 *
 *   body: { "name"?: string, "startDate"?: "yyyy-MM-dd",
 *           "durationWeeks"?: 1…104, "note"?: string }   — at least one
 *
 * Exactly the web form's editable fields. Progress is NOT here: it stays on
 * PATCH …/tasks/:taskId (rpc_set_task_progress), unchanged — the web keeps
 * the two apart too (updateTask vs setTaskProgress). The task, package and
 * project are the URL's; any id in the body is ignored. The task must be
 * that package's and that project's, and not deleted (else 404, before
 * anything is written).
 *
 * Bearer only (no cookie); admin/site (client → 403); project access
 * (non-member → 403). RLS on `tasks` decides again. Returns `{ id }`.
 */
export const dynamic = "force-dynamic";

const EDITABLE = ["name", "startDate", "durationWeeks", "note"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; packageId: string; taskId: string }> }
) {
  try {
    const session = await requireTaskEditorSession();

    const { projectId, packageId, taskId } = await params;
    if (!isUuid(projectId) || !isUuid(packageId) || !isUuid(taskId)) return mobileNotFound();
    // Admin passes implicitly; site needs a project_members row (403).
    await requireProjectAccess(session, projectId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mobileError(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return mobileError(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // Only the editable fields come from the body; the task is the URL's.
    const fields = body as Record<string, unknown>;
    const sent = Object.fromEntries(
      EDITABLE.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]])
    );
    if (Object.keys(sent).length === 0) {
      return mobileError(400, "VALIDATION", "Nothing to update.");
    }
    const parsed = updateTaskSchema.safeParse({ ...sent, id: taskId });
    if (!parsed.success) {
      return mobileError(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const task = await updateTaskFor(session, parsed.data, { projectId, packageId });
    return NextResponse.json({ id: task.id }, { headers: NO_STORE });
  } catch (e) {
    return mobileErrorFrom(e);
  }
}
