import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { adjustInventorySchema } from "@/features/inventory/schema";
import { adjustInventoryFor } from "@/features/inventory/adjust";

/**
 * POST /api/mobile/v1/inventory/:itemId/adjust — an admin corrects an
 * inventory item's quantity on hand. The mobile counterpart of the web's
 * `adjustInventory` action (features/inventory/actions.ts): same schema,
 * same shared helper (features/inventory/adjust.ts), the same
 * rpc_adjust_inventory.
 *
 *   body: { "newQty": <the new quantity on hand, 0 or more>, "reason": "…" }
 *
 * As on the web, an adjustment sets the NEW quantity — the RPC works out the
 * change (in or out) and records it as a stock movement with the reason, then
 * writes the audit row. Only `newQty` and `reason` are read from the body;
 * the item is the URL's, and must be one this admin can see (else 404).
 *
 * Bearer only (no cookie); admin only (site, client → 403). Returns the
 * item's new `qtyOnHand`, its `reorderLevel` (Minimum Stock) and the SQL
 * rule's `status` — what the Inventory list shows.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. Same table as the other mobile mutations. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  REASON_REQUIRED: 422,
};

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; site and client stop here (403).
    const session = await requireRole(["admin"]);

    const { itemId } = await params;
    // Not an id at all: the same answer as an item that does not exist.
    if (!isUuid(itemId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // The item is the URL's; only the new quantity and the reason come from
    // the body, checked by adjustInventorySchema — the web action's own.
    const { newQty, reason } = body as { newQty?: unknown; reason?: unknown };
    const parsed = adjustInventorySchema.safeParse({ itemId, newQty, reason });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const item = await adjustInventoryFor(session, parsed.data);
    return NextResponse.json(
      { id: item.id, qtyOnHand: item.qtyOnHand, reorderLevel: item.reorderLevel, status: item.status },
      { headers: NO_STORE }
    );
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code =
      err instanceof UnauthenticatedError
        ? "UNAUTHENTICATED"
        : err instanceof ForbiddenError
          ? "FORBIDDEN"
          : codeFromPostgresMessage(err.message);
    const status = code ? STATUS_BY_CODE[code] : undefined;
    // mapDomainError owns the user-facing copy (and logs an unmapped error
    // with the reference it returns); a raw database message never leaves.
    const message = mapDomainError(err);
    if (code && status) return errorResponse(status, code, message);
    return errorResponse(500, "INTERNAL", message);
  }
}
