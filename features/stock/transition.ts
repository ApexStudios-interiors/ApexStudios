import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { StockRequestStatus } from "./service";
import type { TransitionStockRequestInput } from "./schema";

/**
 * Moving a stock request along its workflow, once, for every caller — the
 * web's `transitionStockRequest` action (./actions.ts) and the mobile API.
 * Both authenticate, check the role and validate
 * (transitionStockRequestSchema) first; this calls
 * `rpc_transition_stock_request`, which decides everything real: the legal
 * transitions, who may make each, project membership, the rejection reason,
 * the row lock, the stock movement on delivery, the event row and the audit.
 *
 * Returns only what a caller needs — the request's id, new status and
 * project (for the web's cache refresh). Never the row: no rate, no
 * billed_on_bill_id, nothing else it carries. Errors are the RPC's own,
 * thrown as `Error(message)` exactly as before, so each caller's
 * mapDomainError applies unchanged. No caching or revalidation here — that
 * is the web action's concern.
 */
export async function transitionStockRequestFor(
  // Unused today: the RPC reads the caller from the JWT on this client. Kept
  // so every shared write helper has the same shape (createStockRequestFor,
  // postDailyUpdateFor), and so a caller can never forget to authenticate.
  _session: Session,
  input: TransitionStockRequestInput
): Promise<{ id: string; status: StockRequestStatus; projectId: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_transition_stock_request", {
    p_request_id: input.requestId,
    p_to_status: input.toStatus,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  // A `returns public.stock_requests` RPC is typed `unknown` by the generator
  // (scripts/gen-types.mjs maps scalar types only) — only these three
  // columns are read.
  const row = data as { id: string; project_id: string; status: StockRequestStatus };
  return { id: row.id, status: row.status, projectId: row.project_id };
}
