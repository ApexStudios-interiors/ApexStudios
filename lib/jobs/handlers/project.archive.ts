import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Weekly (01-hld.md §10.2): "Archive projects closed > 12 months." Reads
 * `projects.completed_at` (migration 0025, trigger-maintained on the status
 * transition to 'completed') rather than `updated_at` — an unrelated later
 * edit to a completed project must not push its archive date out.
 */
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export async function archiveCompletedProjects(): Promise<void> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - TWELVE_MONTHS_MS).toISOString();

  const { data, error } = await supabase
    .from("projects")
    .update({ status: "archived" })
    .eq("status", "completed")
    .lt("completed_at", cutoff)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);

  console.log(`project.archive: archived ${data?.length ?? 0} project(s)`);
}
