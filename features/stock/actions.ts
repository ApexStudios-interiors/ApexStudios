"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { createStockRequestFor } from "./create";
import { transitionStockRequestFor } from "./transition";
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
    // The D55 rate rule and the RPC call live in ./create.ts, shared with
    // the mobile API so both write paths behave identically.
    const created = await createStockRequestFor(ctx.session, parsedInput);

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return created;
  });

export const transitionStockRequest = siteAction
  .inputSchema(transitionStockRequestSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The RPC call lives in ./transition.ts, shared with the mobile API so
    // both write paths behave identically.
    const moved = await transitionStockRequestFor(ctx.session, parsedInput);

    updateTag(`project:${moved.projectId}`);
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
