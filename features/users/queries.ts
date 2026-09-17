import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/rbac/roles";

export type UserRow = {
  id: string;
  fullName: string;
  /** Email, else phone — the prototype's single Contact column. */
  contact: string | null;
  role: Role;
};

/**
 * The Users page's table. A plain RLS-scoped read: `profiles_select` limits
 * it to the caller's org and live rows, and the page itself is guarded to
 * owner/admin (viewUsers). No money columns exist on profiles.
 */
export async function listUsers(): Promise<UserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role")
    .is("deleted_at", null)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return data.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    contact: p.email ?? p.phone,
    role: p.role,
  }));
}
