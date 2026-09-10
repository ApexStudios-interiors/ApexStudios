"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { createTaskSchema, updateTaskSchema, setTaskProgressSchema } from "./schema";

/**
 * build/05-schedule-and-progress.md §3.2: createTask, updateTask,
 * setTaskProgress — all `siteAction` (owner/admin/site), per 02-lld.md §7.
 * `setTaskProgress` and the phase billing_status flip it triggers both live
 * in `rpc_set_task_progress` (migration 0023) — this action is guard, parse,
 * delegate, revalidate, nothing more (AGENTS.md's layering rule). Plain field
 * edits (name/date/duration/note) are a direct table update instead: RLS
 * already restricts `tasks` writes to owner/admin/site
 * (20260909170005_packages_phases_tasks.sql's `tasks_update` policy), and
 * none of those fields carry a commercial consequence the way progress does.
 */

export const createTask = siteAction.inputSchema(createTaskSchema).action(async ({ parsedInput, ctx }) => {
  const supabase = await createClient();

  // v_phase_site, not the base `phases` table: phases is admin-only on
  // select, but this action is siteAction (owner/admin/site) — a site caller
  // would get a null row here and crash. Found live, not in review. The view
  // carries no money and is exactly the ids this lookup needs, so it is the
  // right read for every role this action allows, not just a site-only branch.
  const { data: phase, error: phaseErr } = await supabase
    .from("v_phase_site")
    .select("project_id, package_id")
    .eq("id", parsedInput.phaseId)
    .single();
  if (phaseErr) throw new Error(phaseErr.message);
  if (!phase.project_id || !phase.package_id) {
    throw new Error("NOT_FOUND: that phase no longer exists");
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      org_id: ctx.session.orgId,
      project_id: phase.project_id,
      package_id: phase.package_id,
      phase_id: parsedInput.phaseId,
      name: parsedInput.name,
      owner_profile_id: parsedInput.ownerProfileId ?? null,
      start_date: parsedInput.startDate,
      duration_weeks: parsedInput.durationWeeks,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  updateTag(`project:${phase.project_id}`);
  revalidatePath(`/projects/${phase.project_id}`, "layout");
  return { id: data.id };
});

export const updateTask = siteAction.inputSchema(updateTaskSchema).action(async ({ parsedInput }) => {
  const { id, ...patch } = parsedInput;
  const supabase = await createClient();

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

  updateTag(`project:${data.project_id}`);
  revalidatePath(`/projects/${data.project_id}`, "layout");
  return { ok: true as const };
});

export const setTaskProgress = siteAction
  .inputSchema(setTaskProgressSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();

    // Read project_id before the write so the RPC's own row lock is held for
    // as short a time as possible — this value doesn't change, so there is no
    // race to read it first.
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("project_id")
      .eq("id", parsedInput.id)
      .single();
    if (taskErr) throw new Error(taskErr.message);

    const { error } = await supabase.rpc("rpc_set_task_progress", {
      p_task_id: parsedInput.id,
      p_pct: parsedInput.progressPct,
    });
    if (error) throw new Error(error.message);

    updateTag(`project:${task.project_id}`);
    // 'layout': the project's dashboard, packages table and every schedule
    // route can all show a number this progress change moved (the rollup
    // trigger updates both the package and the project's own progress_pct in
    // the same write).
    revalidatePath(`/projects/${task.project_id}`, "layout");
    revalidatePath("/");
    return { ok: true as const };
  });

/**
 * A plain, read-only Server Action (not a next-safe-action client, matching
 * features/packages/actions.ts's `getStaffOptions`) — `AddTaskDialog`'s Owner
 * field needs a real profile UUID. Unlike a package lead, a task owner is not
 * admin-only to assign (site creates tasks too), so this has no role guard
 * beyond requiring a session at all.
 */
export async function getOwnerOptions(): Promise<{ id: string; name: string }[]> {
  "use server";
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["owner", "admin", "site"])
    .is("deleted_at", null)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return data.map((p) => ({ id: p.id, name: p.full_name }));
}

/** `AddTaskDialog`'s Phase field — v_phase_site, not `phases` directly, for
 *  the same reason `createTask` above reads it that way: `phases` is
 *  admin-only on select but this dialog is open to site too. */
export async function getPhaseOptions(packageId: string): Promise<{ id: string; name: string }[]> {
  "use server";
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_phase_site")
    .select("id, name, seq_no")
    .eq("package_id", packageId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);
  return data
    .filter((p): p is { id: string; name: string; seq_no: number } => p.id != null && p.name != null)
    .map((p) => ({ id: p.id, name: p.name }));
}

export type TaskForEdit = {
  id: string;
  name: string;
  ownerProfileId: string | null;
  startDate: string;
  durationWeeks: number;
  progressPct: number;
  note: string | null;
};

/** `TaskDetailDialog`'s current values — `tasks` carries no money, so unlike
 *  `getPackageForEdit` this needs no role guard beyond a session existing. */
export async function getTaskForEdit(taskId: string): Promise<TaskForEdit | null> {
  "use server";
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, name, owner_profile_id, start_date, duration_weeks, progress_pct, note")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    ownerProfileId: data.owner_profile_id,
    startDate: data.start_date,
    durationWeeks: data.duration_weeks,
    progressPct: data.progress_pct,
    note: data.note,
  };
}
