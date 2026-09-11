"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { createStockRequestSchema, transitionStockRequestSchema } from "./schema";

/**
 * build/07-stock-inventory-notifications.md §2.2. `rpc_create_stock_request`
 * and `rpc_transition_stock_request` enforce everything real (row locks,
 * transition legality, who may do what) — these are guard, parse, delegate,
 * revalidate, nothing more (AGENTS.md's own layering rule).
 */

export const createStockRequest = siteAction.inputSchema(createStockRequestSchema).action(async ({ parsedInput, ctx }) => {
  // The REAL role, never the impersonated one (lib/auth/session.ts's own
  // rule, established in Build 05: impersonation only ever shapes reads). An
  // admin previewing as site is still really an admin; a site session that
  // somehow crafted a `rate` in its POST body must not have it stored
  // regardless — this check has to be the real role either way.
  const isAdmin = ctx.session.role === "owner" || ctx.session.role === "admin";
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
    // form". The RPC also refuses to store it for a non-admin caller, as a
    // second, harder boundary (a security definer function is the real
    // write path regardless of what called it).
    p_rate: isAdmin ? parsedInput.rate : undefined,
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

export const transitionStockRequest = siteAction.inputSchema(transitionStockRequestSchema).action(async ({ parsedInput }) => {
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
