import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  memberGrantRefusal,
  memberRemovalRefusal,
  type MemberGrantRefusal,
  type MemberRemovalRefusal,
  type MemberRole,
} from "./service";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The project and the profile, both read through the caller's RLS-scoped
 * client: `projects_select` and `profiles_select` are org-scoped, so a row
 * that comes back is one in the caller's own org. Anything else is NOT_FOUND
 * (mapped to user copy by lib/safe-action.ts).
 */
async function readProjectAndProfile(supabase: Supabase, input: { projectId: string; profileId: string }) {
  const [project, profile] = await Promise.all([
    supabase.from("projects").select("id").eq("id", input.projectId).is("deleted_at", null).maybeSingle(),
    supabase
      .from("profiles")
      .select("id, role")
      .eq("id", input.profileId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (project.error) throw new Error(project.error.message);
  if (profile.error) throw new Error(profile.error.message);
  if (!project.data || !profile.data) throw new Error("NOT_FOUND: project or profile");
  return { role: profile.data.role };
}

/**
 * The one project_members insert, shared by addProjectMember (Client access,
 * Site team, Users page) and createClientLogin (features/users/actions.ts).
 * Not an action itself: an export from a "use server" file would be callable
 * from the browser.
 *
 * Runs through the caller's RLS-scoped client — `pm_insert` requires
 * is_admin(). That policy does not check the project's or the profile's org,
 * so both are read first (readProjectAndProfile). memberGrantRefusal then
 * refuses an admin (implicit member, no row) and, when the caller says which
 * card it came from, a profile of the other role.
 */
export async function insertProjectMember(
  supabase: Supabase,
  input: { projectId: string; profileId: string; addedBy: string; expectedRole?: MemberRole }
): Promise<"added" | "already_member" | { status: "refused"; reason: MemberGrantRefusal }> {
  const { role } = await readProjectAndProfile(supabase, input);
  const refusal = memberGrantRefusal({ role, expectedRole: input.expectedRole });
  if (refusal) return { status: "refused", reason: refusal };

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
 * Take a client or site supervisor off one project — the reverse of
 * insertProjectMember. Their other projects, and the login itself, are
 * untouched.
 *
 * Runs through the caller's RLS-scoped client: `pm_delete` requires
 * is_admin(). The rule is memberRemovalRefusal, so an admin (no row) or, from
 * a card that manages one role, a profile of the other role is refused rather
 * than deleted. A member's last project may be removed (2026-11-23).
 */
export async function deleteProjectMember(
  supabase: Supabase,
  input: { projectId: string; profileId: string; expectedRole?: MemberRole }
): Promise<{ status: "removed" } | { status: "refused"; reason: MemberRemovalRefusal }> {
  const [{ role }, membership] = await Promise.all([
    readProjectAndProfile(supabase, input),
    supabase
      .from("project_members")
      .select("project_id")
      .eq("project_id", input.projectId)
      .eq("profile_id", input.profileId)
      .maybeSingle(),
  ]);
  if (membership.error) throw new Error(membership.error.message);

  const refusal = memberRemovalRefusal({
    role,
    isMember: membership.data !== null,
    expectedRole: input.expectedRole,
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
