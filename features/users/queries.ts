import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/rbac/roles";
import { fetchPage, type Page, type PageRequest } from "@/lib/pagination";

export type UserRow = {
  id: string;
  fullName: string;
  /** Email, else phone — the prototype's single Contact column. */
  contact: string | null;
  role: Role;
  email: string | null;
  isActive: boolean;
};

/**
 * The Users page's table, one page at a time. A plain RLS-scoped read:
 * `profiles_select` limits it to the caller's org and live rows, and the page
 * itself is guarded to owner/admin (viewUsers). No money columns exist on
 * profiles.
 *
 * Paginated in the query (`count: "exact"` + `.range()`, lib/pagination.ts);
 * `id` breaks ties between identical names so paging is stable.
 */
export async function listUsers(req: PageRequest): Promise<Page<UserRow>> {
  const supabase = await createClient();
  const page = await fetchPage(
    (from, to) =>
      supabase
        .from("profiles")
        .select("id, full_name, email, phone, role, is_active", { count: "exact" })
        .is("deleted_at", null)
        .order("full_name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    req
  );
  const rows = page.rows.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    contact: p.email ?? p.phone,
    role: p.role,
    email: p.email,
    isActive: p.is_active,
  }));
  return { ...page, rows };
}
