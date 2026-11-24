"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction, siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { isUuid } from "@/lib/routing/slug";
import { createStockRequestFor } from "./create";
import { transitionStockRequestFor } from "./transition";
import {
  createStockRequestSchema,
  duplicateRequestCheckSchema,
  editStockRequestSchema,
  setStockRequestRateSchema,
  transitionStockRequestSchema,
} from "./schema";
import { isDuplicateOfDelivered, type MaterialOption } from "./service";

/**
 * build/07-stock-inventory-notifications.md §2.2. `rpc_create_stock_request`
 * and `rpc_transition_stock_request` enforce everything real (row locks,
 * transition legality, who may do what) — these are guard, parse, delegate,
 * revalidate, nothing more (AGENTS.md's own layering rule).
 */

export const createStockRequest = siteAction
  .inputSchema(createStockRequestSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The D55 rate rule and the RPC call live in ./create.ts, shared with
    // the mobile API so both write paths behave identically.
    let created: { id: string; refNo: string | null; alreadySubmitted: boolean };
    try {
      created = { ...(await createStockRequestFor(ctx.session, parsedInput)), alreadySubmitted: false };
    } catch (e) {
      // APX-44: a retry of a Submit whose response was lost. The request
      // exists; tell the form so, rather than showing an error.
      if (e instanceof Error && e.message.startsWith("ALREADY_SUBMITTED") && parsedInput.id) {
        created = { id: parsedInput.id, refNo: null, alreadySubmitted: true };
      } else {
        throw e;
      }
    }

    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return created;
  });

export const transitionStockRequest = siteAction
  .inputSchema(transitionStockRequestSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The RPC call lives in ./transition.ts, shared with the mobile API so
    // both write paths behave identically.
    const moved = await transitionStockRequestFor(ctx.session, parsedInput);

    revalidatePath(`/projects/${moved.projectId}`, "layout");
    revalidatePath("/inventory");
    return { id: moved.id, status: moved.status };
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
  const isAdmin = effectiveRole === "admin";

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
 *  existing inventory items for the org, not free-text history (build
 *  §2.5 step 4). Read through `v_inventory_site` for every role: names carry
 *  no money, and since 20261124400002 (APX-03) the base table is admin-only.
 *  The mobile options route still returns this name list. */
export async function getMaterialSuggestions(): Promise<string[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_inventory_site")
    .select("name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return [...new Set(data.map((i) => i.name).filter((n): n is string => n != null))];
}

/** APX-15: the items a new request on THIS project may link to — its own
 *  stock and the central store (the only ones trg_stock_requests_inventory_item
 *  accepts) — with their ids and units, so the form can resolve a typed
 *  material to a real item instead of always creating a new one on delivery. */
export async function getMaterialOptions(projectId: string): Promise<MaterialOption[]> {
  await requireSession();
  // Interpolated into a PostgREST filter below, so it must be an id and
  // nothing else.
  if (!isUuid(projectId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_inventory_site")
    .select("id, name, unit, project_id")
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data
    .filter(
      (i): i is { id: string; name: string; unit: string; project_id: string | null } =>
        i.id != null && i.name != null && i.unit != null
    )
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit }));
}

/** APX-42: edit a pending request's quantity, needed-by date and note.
 *  rpc_edit_stock_request decides who (the requester or an admin) and when
 *  (pending only). */
export const editStockRequest = siteAction
  .inputSchema(editStockRequestSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_edit_stock_request", {
      p_request_id: parsedInput.requestId,
      p_qty: parsedInput.qty,
      p_needed_by: parsedInput.neededBy,
      p_note: parsedInput.note,
    });
    if (error) throw new Error(error.message);
    const row = data as { id: string; project_id: string };
    revalidatePath(`/projects/${row.project_id}`, "layout");
    return { id: row.id };
  });

/** APX-14: an admin sets or corrects the rate, until delivery
 *  (rpc_set_stock_request_rate, audited). */
export const setStockRequestRate = adminAction
  .inputSchema(setStockRequestRateSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_set_stock_request_rate", {
      p_request_id: parsedInput.requestId,
      p_rate: parsedInput.rate,
    });
    if (error) throw new Error(error.message);
    const row = data as { id: string; project_id: string };
    revalidatePath(`/projects/${row.project_id}`, "layout");
    return { id: row.id };
  });

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
