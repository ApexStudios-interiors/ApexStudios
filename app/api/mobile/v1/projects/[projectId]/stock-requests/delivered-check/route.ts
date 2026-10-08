import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, requireProjectAccess } from "@/lib/auth/session";
import { NO_STORE, mobileErrorFrom, mobileNotFound, requireBearerSession } from "@/lib/mobile/api";
import { isUuid } from "@/lib/routing/slug";
import { hasDeliveredDuplicate } from "@/features/stock/actions";
import { DUPLICATE_DELIVERED_WARNING } from "@/features/stock/service";

/**
 * GET /api/mobile/v1/projects/:projectId/stock-requests/delivered-check
 *     ?materialName=…&qty=…&neededBy=yyyy-MM-dd
 * — the New Stock Request form's advisory "already delivered" check: the
 * web dialog's own `hasDeliveredDuplicate` (features/stock/actions.ts),
 * unchanged. It looks, through the user's own RLS-scoped client, for a
 * DELIVERED request of this project with the same quantity and needed-by
 * date, then applies `isDuplicateOfDelivered` (same material, trimmed and
 * case-insensitive). Input it cannot parse is simply "no".
 *
 * Answers `{ warning }`: the web's own DUPLICATE_DELIVERED_WARNING when it
 * matches, else null — one string, so web and mobile show the same words.
 * An advisory only: nothing here blocks, changes or creates anything.
 *
 * Bearer only; admin/site (the roles that raise a request — client 403);
 * project access (non-member 403); a malformed project id is 404.
 */
export const dynamic = "force-dynamic";

const STOCK_ROLES = ["admin", "site"];

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await requireBearerSession();
    if (!STOCK_ROLES.includes(session.role)) throw new ForbiddenError("requires one of: admin, site");

    const { projectId } = await params;
    if (!isUuid(projectId)) return mobileNotFound();
    // Admin passes implicitly; site needs a project_members row (403).
    await requireProjectAccess(session, projectId);

    const query = new URL(request.url).searchParams;
    const found = await hasDeliveredDuplicate({
      projectId,
      materialName: query.get("materialName") ?? "",
      qty: query.get("qty") ?? "",
      neededBy: query.get("neededBy") ?? "",
    });

    return NextResponse.json({ warning: found ? DUPLICATE_DELIVERED_WARNING : null }, { headers: NO_STORE });
  } catch (e) {
    return mobileErrorFrom(e);
  }
}
