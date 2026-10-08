import "server-only";
import { ForbiddenError, type Session } from "@/lib/auth/session";
import { requireBearerSession } from "@/lib/mobile/api";
import { CAN } from "@/lib/rbac/permissions";
import type { Role } from "@/lib/rbac/roles";

/** The web's own `createEditTask` list — admin and site. */
const TASK_EDITORS: readonly Role[] = CAN.createEditTask;

/**
 * The Bearer session, for a user who may create or edit schedule tasks: the
 * web's `siteAction` guard on `createTask`/`updateTask` (`requireRole`, the
 * REAL role — admin or site), on the one Bearer-verified session rather than
 * verifying the token a second time. A client is 403; RLS on `tasks` refuses
 * one again regardless.
 */
export async function requireTaskEditorSession(): Promise<Session> {
  const session = await requireBearerSession();
  if (!TASK_EDITORS.includes(session.role)) {
    throw new ForbiddenError(`requires one of: ${TASK_EDITORS.join(", ")}`);
  }
  return session;
}
