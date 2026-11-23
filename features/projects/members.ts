import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { clientAccessRemovalRefusal, type ClientAccessRemovalRefusal } from "./service";

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

/**
 * Take a client login off one project — the reverse of insertProjectMember.
 * Their other projects, and the login itself, are untouched.
 *
 * Runs through the caller's RLS-scoped client: `pm_delete` requires
 * is_admin(). As with the insert, the project and the profile are read first
 * through the same client (both reads org-scoped), and the rule is
 * clientAccessRemovalRefusal — so a site supervisor's membership, or a
 * client's last project, is refused rather than deleted.
 *
 * Two removals racing for the same client's last two projects could each see
 * a count of 2; that would leave a login with no project, which Add existing
 * client or Deactivate puts right. Not worth a lock for a two-admin org.
 */
export async function deleteProjectMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { projectId: string; profileId: string }
): Promise<{ status: "removed" } | { status: "refused"; reason: ClientAccessRemovalRefusal }> {
  const [project, profile, memberships] = await Promise.all([
    supabase.from("projects").select("id").eq("id", input.projectId).is("deleted_at", null).maybeSingle(),
    supabase
      .from("profiles")
      .select("id, role")
      .eq("id", input.profileId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("project_members").select("project_id").eq("profile_id", input.profileId),
  ]);
  if (project.error) throw new Error(project.error.message);
  if (profile.error) throw new Error(profile.error.message);
  if (memberships.error) throw new Error(memberships.error.message);
  if (!project.data || !profile.data) throw new Error("NOT_FOUND: project or profile");

  const projectIds = memberships.data.map((m) => m.project_id);
  // Count live projects only: a membership row on a soft-deleted project is
  // not a project the client can actually use.
  let projectCount = 0;
  if (projectIds.length > 0) {
    const live = await supabase.from("projects").select("id").in("id", projectIds).is("deleted_at", null);
    if (live.error) throw new Error(live.error.message);
    projectCount = live.data.length;
  }

  const refusal = clientAccessRemovalRefusal({
    role: profile.data.role,
    isMember: projectIds.includes(input.projectId),
    projectCount,
  });
  if (refusal) return { status: "refused", reason: refusal };

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", input.projectId)
    .eq("profile_id", input.profileId);
  if (error) throw new Error(error.message);
  return { status: "removed" };
}
