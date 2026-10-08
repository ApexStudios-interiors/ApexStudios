import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CreateTaskInput, UpdateTaskInput } from "./schema";

/**
 * Creating and editing a schedule task, once, for every caller — the web's
 * `createTask` / `updateTask` actions (./actions.ts: AddTaskDialog and
 * TaskDetailDialog) and the mobile API. Each caller authenticates, checks the
 * role (admin/site) and validates (createTaskSchema / updateTaskSchema)
 * first. These are plain table writes, as the web's always were: RLS on
 * `tasks` decides again (tasks_insert / tasks_update: a member of the
 * project, admin or site), and the rollup trigger keeps package and project
 * progress right. Progress itself is never written here — that is
 * ./progress.ts and rpc_set_task_progress.
 *
 * `scope`, when given (the mobile route's URL), must be the phase's / task's
 * own project and package: anything else is NOT_FOUND, before anything is
 * written — a task is never created or changed through another package's
 * address. Errors are thrown as `Error(message)`, so each caller's
 * mapDomainError applies unchanged. No caching or revalidation here — that
 * is the web action's concern.
 */

type Scope = { projectId: string; packageId: string };

export async function createTaskFor(
  session: Session,
  input: CreateTaskInput,
  scope?: Scope
): Promise<{ id: string; projectId: string; packageId: string }> {
  const supabase = await createClient();

  // v_phase_site, not the base `phases` table: phases is admin-only on
  // select, but this is open to site too — a site caller would get a null
  // row there and crash. Found live, not in review. The view carries no money
  // and is exactly the ids this lookup needs, and it only shows phases of the
  // caller's own projects (is_member_of), so it is the right read for every
  // role allowed here.
  const { data: phase, error: phaseErr } = await supabase
    .from("v_phase_site")
    .select("project_id, package_id")
    .eq("id", input.phaseId)
    .maybeSingle();
  if (phaseErr) throw new Error(phaseErr.message);
  if (!phase?.project_id || !phase.package_id) {
    throw new Error("NOT_FOUND: that phase no longer exists");
  }
  if (scope && (phase.project_id !== scope.projectId || phase.package_id !== scope.packageId)) {
    throw new Error("NOT_FOUND: that phase does not belong to this package");
  }

  // The project and package always come from the phase, never the caller.
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      org_id: session.orgId,
      project_id: phase.project_id,
      package_id: phase.package_id,
      phase_id: input.phaseId,
      name: input.name,
      owner_profile_id: input.ownerProfileId ?? null,
      start_date: input.startDate,
      duration_weeks: input.durationWeeks,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return { id: data.id, projectId: phase.project_id, packageId: phase.package_id };
}

export async function updateTaskFor(
  // The write is RLS-scoped to the caller's JWT on this client. Kept so every
  // shared write helper has the same shape.
  _session: Session,
  input: UpdateTaskInput,
  scope?: Scope
): Promise<{ id: string; projectId: string }> {
  const { id, ...patch } = input;
  const supabase = await createClient();

  if (scope) {
    // Only for an address that names a project and package (the mobile
    // route): the task must be theirs, and not deleted. RLS-scoped, so a task
    // of a project the caller is not a member of is simply not found.
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, project_id, package_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (taskErr) throw new Error(taskErr.message);
    if (!task) throw new Error("NOT_FOUND: this task no longer exists");
    if (task.project_id !== scope.projectId || task.package_id !== scope.packageId) {
      throw new Error("NOT_FOUND: this task does not belong to this package");
    }
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.startDate !== undefined && { start_date: patch.startDate }),
      ...(patch.durationWeeks !== undefined && { duration_weeks: patch.durationWeeks }),
      ...(patch.note !== undefined && { note: patch.note }),
    })
    .eq("id", id)
    .select("id, project_id")
    .single();
  if (error) throw new Error(error.message);

  return { id: data.id, projectId: data.project_id };
}
