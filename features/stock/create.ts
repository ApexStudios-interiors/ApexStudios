import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getProjectRateVisibility } from "@/features/projects/actions";
import { siteMayEnterRate } from "@/features/projects/service";
import type { CreateStockRequestInput } from "./schema";

/**
 * Creating a stock request, once, for every caller — the web's
 * `createStockRequest` action (./actions.ts) and the mobile API. Both
 * authenticate and validate (createStockRequestSchema) first; this applies
 * the application-level D55 rate rule and calls `rpc_create_stock_request`,
 * which enforces everything real (membership, role, material, quantity, the
 * same rate rule again, and — via trg_stock_requests_ancestry — the
 * package/phase ancestry).
 *
 * Errors are the RPC's own, thrown as `Error(message)` exactly as before, so
 * each caller's existing error mapping (mapDomainError) applies unchanged.
 * No caching or revalidation here — that is the web action's concern.
 */
export async function createStockRequestFor(
  session: Session,
  input: CreateStockRequestInput
): Promise<{ id: string; refNo: string }> {
  // The REAL role, never the impersonated one (lib/auth/session.ts's own
  // rule, established in Build 05: impersonation only ever shapes reads). An
  // admin previewing as site is still really an admin; a site session that
  // somehow crafted a `rate` in its POST body must not have it stored
  // regardless — this check has to be the real role either way.
  const isAdmin = session.role === "admin";
  // D55: a site supervisor may set a rate only where THIS project is
  // explicitly set to 'editable'. 'hidden' and 'readonly' both discard it,
  // so a crafted POST body cannot set one just because the field was not
  // rendered. Read server-side, from the project row, never taken from the
  // form. Skipped for an admin, whose answer does not depend on it.
  const mayEnterRate = isAdmin || siteMayEnterRate(await getProjectRateVisibility(input.projectId));
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("rpc_create_stock_request", {
    p_project_id: input.projectId,
    p_package_id: input.packageId,
    p_material_name: input.materialName,
    p_qty: input.qty,
    p_unit: input.unit,
    p_phase_id: input.phaseId,
    p_inventory_item_id: input.inventoryItemId,
    // Stripped here, before the RPC is ever called — not "ignored in the
    // form". The RPC applies the same rule again (admin always; site only
    // where the project is 'editable'), as a second, harder boundary: a
    // security definer function is the real write path regardless of what
    // called it.
    p_rate: mayEnterRate ? input.rate : undefined,
    p_needed_by: input.neededBy,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  // The generated type for a `returns public.stock_requests` RPC is
  // `unknown` (scripts/gen-types.mjs only maps scalar Postgres types, not
  // composite/row ones) — same shape rpc_claim_jobs already needed a local
  // cast for in lib/jobs/runner.ts.
  const row = data as { id: string; ref_no: string };
  return { id: row.id, refNo: row.ref_no };
}
