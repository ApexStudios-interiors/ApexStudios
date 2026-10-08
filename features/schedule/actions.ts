"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { createTaskSchema, updateTaskSchema, setTaskProgressSchema } from "./schema";
import { setTaskProgressFor } from "./progress";
import { createTaskFor, updateTaskFor } from "./tasks";

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
  // The phase lookup and the insert live in ./tasks.ts, shared with the
  // mobile API so both write paths behave identically.
  const task = await createTaskFor(ctx.session, parsedInput);

  updateTag(`project:${task.projectId}`);
  revalidatePath(`/projects/${task.projectId}`, "layout");
  return { id: task.id };
});

export const updateTask = siteAction.inputSchema(updateTaskSchema).action(async ({ parsedInput, ctx }) => {
  // The update lives in ./tasks.ts, shared with the mobile API.
  const task = await updateTaskFor(ctx.session, parsedInput);

  updateTag(`project:${task.projectId}`);
  revalidatePath(`/projects/${task.projectId}`, "layout");
  return { ok: true as const };
});

export const setTaskProgress = siteAction
  .inputSchema(setTaskProgressSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The read and the RPC call live in ./progress.ts, shared with the mobile
    // API so both write paths behave identically.
    const task = await setTaskProgressFor(ctx.session, parsedInput);

    updateTag(`project:${task.projectId}`);
    // 'layout': the project's dashboard, packages table and every schedule
    // route can all show a number this progress change moved (the rollup
    // trigger updates both the package and the project's own progress_pct in
    // the same write).
    revalidatePath(`/projects/${task.projectId}`, "layout");
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
    .in("role", ["admin", "site"])
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
