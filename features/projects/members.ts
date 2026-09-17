import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * The one project_members insert, shared by addProjectMember and
 * createClientLogin (features/users/actions.ts). Not an action itself: an
 * export from a "use server" file would be callable from the browser.
 *
 * Runs through the caller's RLS-scoped client — `pm_insert` requires
 * is_admin(). That policy does not check the project's or the profile's org,
 * so both are read first through the same client: `projects_select` and
 * `profiles_select` are org-scoped, so a row that comes back is one in the
 * caller's own org. Anything else is NOT_FOUND (mapped to user copy by
 * lib/safe-action.ts).
 */
export async function insertProjectMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { projectId: string; profileId: string; addedBy: string }
): Promise<"added" | "already_member"> {
  const [project, profile] = await Promise.all([
    supabase.from("projects").select("id").eq("id", input.projectId).is("deleted_at", null).maybeSingle(),
    supabase.from("profiles").select("id").eq("id", input.profileId).is("deleted_at", null).maybeSingle(),
  ]);
  if (project.error) throw new Error(project.error.message);
  if (profile.error) throw new Error(profile.error.message);
  if (!project.data || !profile.data) throw new Error("NOT_FOUND: project or profile");

  const { error } = await supabase.from("project_members").insert({
    project_id: input.projectId,
    profile_id: input.profileId,
    added_by: input.addedBy,
  });
  // 23505: the (project_id, profile_id) primary key — already a member.
  if (error?.code === "23505") return "already_member";
  if (error) throw new Error(error.message);
  return "added";
}
