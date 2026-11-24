import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { recordUsageSchema } from "@/features/inventory/schema";
import { recordUsageFor } from "@/features/inventory/usage";

/**
 * POST /api/mobile/v1/inventory/:itemId/usage — a site supervisor (or admin)
 * records material used on site, against a package (APX-69). The mobile
 * counterpart of the web's `recordStockUsage` action
 * (features/inventory/actions.ts): same schema, same shared helper
 * (features/inventory/usage.ts), the same rpc_record_stock_usage.
 *
 *   body: { "packageId": "<uuid>", "qty": <more than 0>, "note"?: "…" }
 *
 * The RPC writes an 'out' stock movement and lowers the quantity on hand,
 * never below zero (NEGATIVE_STOCK → 409), under the item's row lock, and
 * audits it. The package must be in the item's project (else 404).
 *
 * Bearer only (no cookie); admin and site (client → 403). Returns the item's
 * new `qtyOnHand`, `reorderLevel` and `status` — no money.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NEGATIVE_STOCK: 409,
  REASON_REQUIRED: 422,
};

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    const session = await requireRole(["admin", "site"]);

    const { itemId } = await params;
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

    // The item is the URL's; only the package, quantity and note come from the
    // body, checked by recordUsageSchema — the web action's own.
    const { packageId, qty, note } = body as { packageId?: unknown; qty?: unknown; note?: unknown };
    const parsed = recordUsageSchema.safeParse({ itemId, packageId, qty, note });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const item = await recordUsageFor(session, parsed.data);
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
    const message = mapDomainError(err);
    if (code && status) return errorResponse(status, code, message);
    return errorResponse(500, "INTERNAL", message);
  }
}
