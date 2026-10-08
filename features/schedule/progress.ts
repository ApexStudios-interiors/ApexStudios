import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { SetTaskProgressInput } from "./schema";

/**
 * Setting one task's progress, once, for every caller — the web's
 * `setTaskProgress` action (./actions.ts, TaskDetailDialog's slider) and the
 * mobile API. Each authenticates, checks the role (admin/site) and validates
 * (setTaskProgressSchema: a whole number 0–100) first.
 *
 * Reads the task first (RLS-scoped, so a task in a project the caller is not
 * a member of is simply not found), then calls `rpc_set_task_progress`, which
 * decides everything real: membership and admin/site, 0–100 again, the write,
 * the phase's billing_status flip (never for a phase already billed/paid),
 * the audit row — and, through trg_tasks_after_update, the package's and the
 * project's rolled-up progress.
 *
 * `scope`, when given (the mobile route's URL), must be the task's own
 * project and package: anything else is NOT_FOUND, before anything is
 * written — a task is never changed through another package's address.
 *
 * Errors are thrown as `Error(message)`, so each caller's mapDomainError
 * applies unchanged. No caching or revalidation here — that is the web
 * action's concern.
 */
export async function setTaskProgressFor(
  // The RPC reads the caller from the JWT on this client. Kept so every
  // shared write helper has the same shape.
  _session: Session,
  input: SetTaskProgressInput,
  scope?: { projectId: string; packageId: string }
): Promise<{ id: string; progressPct: number; projectId: string; packageId: string }> {
  const supabase = await createClient();

  // Read before the write so the RPC's own row lock is held as briefly as
  // possible — these values do not change, so there is no race to read them.
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("id, project_id, package_id")
    .eq("id", input.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (taskErr) throw new Error(taskErr.message);
  if (!task) throw new Error("NOT_FOUND: this task no longer exists");
  if (scope && (task.project_id !== scope.projectId || task.package_id !== scope.packageId)) {
    throw new Error("NOT_FOUND: this task does not belong to this package");
  }

  const { error } = await supabase.rpc("rpc_set_task_progress", {
    p_task_id: input.id,
    p_pct: input.progressPct,
  });
  if (error) throw new Error(error.message);

  return {
    id: task.id,
    progressPct: input.progressPct,
    projectId: task.project_id,
    packageId: task.package_id,
  };
}
