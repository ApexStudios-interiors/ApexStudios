import type { UserAdminRefusal } from "@/features/users/service";

/**
 * Why a Users-page control is disabled on a row, as its tooltip. The reasons
 * are the server's own (userAdminRefusal and the two that build on it), so the
 * explanation the user reads is the rule the action enforces, not a second
 * description of it that could drift.
 */
export const USER_ADMIN_REFUSAL_TITLE: Record<UserAdminRefusal, string> = {
  not_found: "This user no longer exists.",
  self: "You can't change your own role or deactivate yourself.",
  forbidden_role: "Only the owner can change an owner's or an admin's role, or deactivate them.",
  unassignable_role: "That role can't be assigned here.",
  no_change: "Nothing to change.",
  last_owner: "This is the only active owner. Make someone else an owner first.",
};
