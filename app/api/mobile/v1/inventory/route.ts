import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireProjectAccess, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { getBusinessInventory, type InventoryItemDTO } from "@/features/inventory/queries";
import { normalizeInventorySearch } from "@/features/inventory/service";
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination";

/**
 * GET /api/mobile/v1/inventory — the web's business-wide Inventory page
 * (app/(app)/inventory/page.tsx) as data, read-only: the stat row (Total
 * Items, Total Value for admin, Low Stock, Critical) and one page of items,
 * from the same getBusinessInventory — so the same role-scoped views
 * (v_inventory_status for admin, v_inventory_site for site), the same SQL
 * stock status, the same search and the same stats RPC.
 *
 *   ?q=<text>          the web's "Search items…": name or category, trimmed,
 *                      at most 80 characters (normalizeInventorySearch)
 *   ?projectId=<uuid>  the web's project filter (omitted: All projects)
 *   ?page=1,2,…        fixed 25 a page (one of the web table's sizes)
 *
 * Admin and site only — the web shows Inventory to every role but client
 * (Sidebar), and a client here is refused (403) rather than handed an empty
 * list. A project filter is checked against the caller's project access.
 *
 * Each item is what the web table shows: Item (+ category), Project
 * ("Central store" when null), On Hand, Minimum Stock, Value (admin only —
 * the key is absent for site), Location, Status (ok / low / critical).
 * Nothing here changes inventory.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
};

/** One of the web table's own page sizes — fixed, never the client's. */
const PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 25;
const MAX_PAGE = 1000;

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const params = new URL(request.url).searchParams;
    const search = normalizeInventorySearch(params.get("q") ?? undefined);
    const rawProjectId = params.get("projectId");
    if (rawProjectId !== null && !isUuid(rawProjectId)) {
      return errorResponse(400, "VALIDATION", "projectId must be a valid id.");
    }
    const projectId = rawProjectId ?? undefined;
    const rawPage = params.get("page");
    if (rawPage !== null && !(/^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= MAX_PAGE)) {
      return errorResponse(400, "VALIDATION", `page must be a whole number from 1 to ${MAX_PAGE}.`);
    }
    const page = rawPage === null ? 1 : Number(rawPage);

    // A project filter must be one of the caller's projects (admin: any).
    if (projectId) await requireProjectAccess(session, projectId);

    const { items, stats } = await getBusinessInventory(
      session,
      { projectId, search },
      { page, pageSize: PAGE_SIZE }
    );

    const isAdmin = session.role === "admin";
    const toMobile = (i: InventoryItemDTO) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      projectId: i.projectId,
      projectName: i.projectName,
      qtyOnHand: i.qtyOnHand,
      reorderLevel: i.reorderLevel,
      unit: i.unit,
      // Admin money: the key exists only for an admin.
      ...(isAdmin ? { stockValue: i.stockValue } : {}),
      location: i.location,
      status: i.status,
    });

    return NextResponse.json(
      {
        // The session's real role — the only role the app branches on.
        role: session.role,
        stats: {
          totalItems: stats.totalItems,
          ...(isAdmin ? { totalValue: stats.totalValue } : {}),
          lowCount: stats.lowCount,
          criticalCount: stats.criticalCount,
        },
        items: items.rows.map(toMobile),
        total: items.total,
        page: items.page,
        pageSize: items.pageSize,
        hasMore: items.page * items.pageSize < items.total,
      },
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
