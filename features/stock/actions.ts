"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { getProjectRateVisibility } from "@/features/projects/actions";
import { siteMayEnterRate } from "@/features/projects/service";
import {
  createStockRequestSchema,
  duplicateRequestCheckSchema,
  transitionStockRequestSchema,
} from "./schema";
import { isDuplicateOfDelivered } from "./service";

/**
 * build/07-stock-inventory-notifications.md §2.2. `rpc_create_stock_request`
 * and `rpc_transition_stock_request` enforce everything real (row locks,
 * transition legality, who may do what) — these are guard, parse, delegate,
 * revalidate, nothing more (AGENTS.md's own layering rule).
 */

export const createStockRequest = siteAction
  .inputSchema(createStockRequestSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The REAL role, never the impersonated one (lib/auth/session.ts's own
    // rule, established in Build 05: impersonation only ever shapes reads). An
    // admin previewing as site is still really an admin; a site session that
    // somehow crafted a `rate` in its POST body must not have it stored
    // regardless — this check has to be the real role either way.
    const isAdmin = ctx.session.role === "owner" || ctx.session.role === "admin";
    // D55: a site supervisor may set a rate only where THIS project is
    // explicitly set to 'editable'. 'hidden' and 'readonly' both discard it,
    // so a crafted POST body cannot set one just because the field was not
    // rendered. Read server-side, from the project row, never taken from the
    // form. Skipped for an admin, whose answer does not depend on it.
    const mayEnterRate = isAdmin || siteMayEnterRate(await getProjectRateVisibility(parsedInput.projectId));
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("rpc_create_stock_request", {
      p_project_id: parsedInput.projectId,
      p_package_id: parsedInput.packageId,
      p_material_name: parsedInput.materialName,
      p_qty: parsedInput.qty,
      p_unit: parsedInput.unit,
      p_phase_id: parsedInput.phaseId,
      p_inventory_item_id: parsedInput.inventoryItemId,
      // Stripped here, before the RPC is ever called — not "ignored in the
      // form". The RPC applies the same rule again (owner/admin always; site
      // only where the project is 'editable'), as a second, harder boundary:
      // a security definer function is the real write path regardless of what
      // called it.
      p_rate: mayEnterRate ? parsedInput.rate : undefined,
      p_needed_by: parsedInput.neededBy,
      p_note: parsedInput.note,
    });
    if (error) throw new Error(error.message);
    // The generated type for a `returns public.stock_requests` RPC is
    // `unknown` (scripts/gen-types.mjs only maps scalar Postgres types, not
    // composite/row ones) — same shape rpc_claim_jobs already needed a local
    // cast for in lib/jobs/runner.ts.
    const row = data as { id: string; ref_no: string };

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return { id: row.id, refNo: row.ref_no };
  });

export const transitionStockRequest = siteAction
  .inputSchema(transitionStockRequestSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_transition_stock_request", {
      p_request_id: parsedInput.requestId,
      p_to_status: parsedInput.toStatus,
      p_note: parsedInput.note,
    });
    if (error) throw new Error(error.message);
    const row = data as { id: string; project_id: string; status: string };

    updateTag(`project:${row.project_id}`);
    revalidatePath(`/projects/${row.project_id}`, "layout");
    revalidatePath("/inventory");
    return { id: row.id, status: row.status };
  });

/**
 * "Has this exact order already been delivered?" — the New Stock Request
 * form's advisory warning. An ALERT, never a block: it changes nothing about
 * what may be submitted or about the request workflow.
 *
 * Read through the user's own Supabase client, so RLS decides which requests
 * they may match against — never Drizzle (the D11 rule). A site session reads
 * `v_stock_request_site`, which omits `rate`; an admin reads the base table
 * with the same column list, so no money leaves the database on this path for
 * either role.
 *
 * Narrowed in the QUERY to the fields that can be compared in SQL (project,
 * delivered, quantity, needed-by); the material rule — linked inventory item
 * when there is one, trimmed case-insensitive name otherwise — is then applied
 * by `isDuplicateOfDelivered`, which is pure and unit-tested.
 */
export async function hasDeliveredDuplicate(input: unknown): Promise<boolean> {
  const session = await requireSession();
  const parsed = duplicateRequestCheckSchema.safeParse(input);
  if (!parsed.success) return false;
  const candidate = parsed.data;

  const effectiveRole = session.impersonating?.role ?? session.role;
  // 01-hld.md §7.1: a client has no stock surface at all.
  if (effectiveRole === "client") return false;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const supabase = await createClient();
  const columns = "id, inventory_item_id, material_name, qty, needed_by";
  const { data, error } = isAdmin
    ? await supabase
        .from("stock_requests")
        .select(columns)
        .eq("project_id", candidate.projectId)
        .eq("status", "delivered")
        .eq("qty", candidate.qty)
        .eq("needed_by", candidate.neededBy)
        .is("deleted_at", null)
    : await supabase
        .from("v_stock_request_site")
        .select(columns)
        .eq("project_id", candidate.projectId)
        .eq("status", "delivered")
        .eq("qty", candidate.qty)
        .eq("needed_by", candidate.neededBy);
  if (error) throw new Error(error.message);

  return (data ?? []).some((row) =>
    isDuplicateOfDelivered(candidate, {
      inventoryItemId: row.inventory_item_id,
      materialName: row.material_name ?? "",
      qty: Number(row.qty),
      neededBy: row.needed_by,
    })
  );
}

/** `NewRequestDialog`'s material-name suggestion list — sourced from
 *  existing `inventory_items` for the org, not free-text history (build
 *  §2.5 step 4). No role branching needed: names carry no money. */
export async function getMaterialSuggestions(): Promise<string[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return [...new Set(data.map((i) => i.name))];
}

/** `NewRequestDialog`'s Package field — `v_package_site`, not `packages`
 *  directly, for the same reason `features/schedule/actions.ts`'s own
 *  `getPhaseOptions` reads the site view: `packages` is admin-only on
 *  select, but this dialog is open to site too, and a package name carries
 *  no money. */
export async function getPackageOptions(projectId: string): Promise<{ id: string; name: string }[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_package_site")
    .select("id, name, seq_no")
    .eq("project_id", projectId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);
  return data
    .filter((p): p is { id: string; name: string; seq_no: number } => p.id != null && p.name != null)
    .map((p) => ({ id: p.id, name: p.name }));
}

/** The closed `units` vocabulary (D-series decision predating this build,
 *  Build 02) — free text would produce "Bags"/"bags"/"BAG" within a week.
 *  Readable by every signed-in user; there is nothing confidential in it. */
export async function getUnitOptions(): Promise<{ code: string; label: string }[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .select("code, label")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}
