import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canAddPhotos, type ApprovalStatus } from "./service";

/**
 * The approval a sample photo is being added to, checked the way
 * `addSamplePhotos` (./actions.ts) always has: it must exist for this session
 * (`ap_select` is membership-scoped, so another project's approval simply is
 * not found) and still be pending — photos are frozen once it is decided
 * (build §2.5; the RLS freeze on `attachments`, migrations 0036/0037, is the
 * real boundary). Shared by that action and the mobile photo routes, which
 * need the approval's project before an upload can be signed for it.
 *
 * Throws the domain errors callers already map: NOT_FOUND, ILLEGAL_TRANSITION.
 */
export async function approvalForPhotos(
  approvalId: string
): Promise<{ id: string; projectId: string; status: ApprovalStatus }> {
  const supabase = await createClient();
  const { data: approval, error } = await supabase
    .from("approvals")
    .select("id, project_id, status")
    .eq("id", approvalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // ap_select's own membership scoping simply excludes a row this session
  // cannot see, rather than raising — a clean error here.
  if (!approval) throw new Error("NOT_FOUND: this approval no longer exists");
  if (!canAddPhotos(approval.status)) {
    throw new Error("ILLEGAL_TRANSITION: photos can only be added to a pending approval");
  }
  return { id: approval.id, projectId: approval.project_id, status: approval.status };
}
