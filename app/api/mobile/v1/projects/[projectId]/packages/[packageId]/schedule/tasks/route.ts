import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileError, mobileErrorFrom, mobileNotFound } from "@/lib/mobile/api";
import { requireProjectAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/routing/slug";
import { createTaskSchema } from "@/features/schedule/schema";
import { createTaskFor } from "@/features/schedule/tasks";
import { requireTaskEditorSession } from "@/features/schedule/mobile";

/**
 * POST /api/mobile/v1/projects/:projectId/packages/:packageId/schedule/tasks
 * — add a task to one of the package's phases. The mobile counterpart of the
 * web's `createTask` action (features/schedule/actions.ts, AddTaskDialog):
 * the same guard (admin/site), the same schema (createTaskSchema), the same
 * shared helper (features/schedule/tasks.ts).
 *
 *   body: { "phaseId": uuid, "name": string, "ownerProfileId"?: uuid | "",
 *           "startDate": "yyyy-MM-dd", "durationWeeks": 1…104 }
 *
 * Exactly the web form's fields; anything else in the body (a project or
 * package id included) is dropped by the schema. The project and package are
 * the URL's: the phase must belong to both (else 404, before anything is
 * written), and the task takes its project and package from the phase, never
 * from the caller. The server sets the id and organisation.
 *
 * Bearer only (no cookie); admin/site (client → 403); project access
 * (non-member → 403). RLS on `tasks` decides again. Returns `{ id }` (201).
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; packageId: string }> }
) {
  try {
    const session = await requireTaskEditorSession();

    const { projectId, packageId } = await params;
    // Not an id at all: the same answer as a record that does not exist.
    if (!isUuid(projectId) || !isUuid(packageId)) return mobileNotFound();
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

    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return mobileError(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const task = await createTaskFor(session, parsed.data, { projectId, packageId });
    return NextResponse.json({ id: task.id }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return mobileErrorFrom(e);
  }
}
