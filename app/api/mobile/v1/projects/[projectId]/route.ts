import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileErrorFrom, mobileNotFound, requireBearerSession } from "@/lib/mobile/api";
import { requireProjectAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/routing/slug";
import { getClientBillingStats, getProjectHeader, getSiteStockStats } from "@/features/projects/queries";
import { getPackagesForProject } from "@/features/packages/queries";
import { getUpdatesForProject } from "@/features/updates/queries";
import { getStockRequestsForProject } from "@/features/stock/queries";
import { getApprovalsForProject } from "@/features/approvals/queries";

/**
 * GET /api/mobile/v1/projects/:projectId — one project's dashboard, the data
 * the web's app/(app)/projects/[projectId]/page.tsx renders.
 *
 * Authenticates with `Authorization: Bearer <Supabase access token>` (D67).
 * middleware.ts skips /api/mobile/*, and the web's project layout — which is
 * where requireProjectAccess runs for the web — does not wrap a route
 * handler, so this route makes both checks itself: admin passes implicitly,
 * site and client need a project_members row.
 *
 * Every figure comes from the same query functions the web page calls, so
 * the role shaping is theirs, unchanged: admin's money stays admin-only, site
 * reads the money-free stock view, and a client gets no stock requests at all
 * (the page does not even run that query for a client). The top-level `role`
 * is the session's — the queries' own "money" tag is not a user role.
 *
 * Deliberately not included yet: the admin-only Client access and Rate
 * visibility cards, and the two figures the page computes itself (site
 * "Packages in Progress", client "Bills Raised") — `stats` is the raw query
 * result. Attachment URLs are the queries' own short-lived presigned URLs.
 *
 * Bearer only (lib/mobile/api.ts requireBearerSession): a request without an
 * `Authorization: Bearer` header is refused before anything else, so a
 * browser's session cookie can never authorize it. Errors are
 * `{ error, message }`, as on every other mobile route.
 */
export const dynamic = "force-dynamic";

/** The dashboard's preview lengths, as on the web page. */
const LATEST_UPDATES = 3;
const PENDING_APPROVALS = 5;
const PENDING_REQUESTS = 5;

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await requireBearerSession();
    const { projectId } = await params;
    // Not a project id at all: the same answer as a project that does not
    // exist, rather than a database error about a malformed uuid.
    if (!isUuid(projectId)) {
      return mobileNotFound();
    }
    await requireProjectAccess(session, projectId);

    const rawHeader = await getProjectHeader(session, projectId);
    if (!rawHeader) return mobileNotFound();
    // Everything but rateVisibility, which belongs to the admin-only Rate
    // visibility card (D55) that mobile does not show yet.
    const header = {
      id: rawHeader.id,
      name: rawHeader.name,
      client: rawHeader.client,
      location: rawHeader.location,
      start: rawHeader.start,
      status: rawHeader.status,
      progressPct: rawHeader.progressPct,
    };

    const isClient = session.role === "client";
    const [packagesResult, updatesPage, approvals, requests, roleStats] = await Promise.all([
      getPackagesForProject(session, projectId),
      getUpdatesForProject(session, projectId),
      getApprovalsForProject(session, projectId, { status: "pending" }),
      // 01-hld.md §7.1: a client has no stock visibility — not fetched.
      isClient ? null : getStockRequestsForProject(session, projectId, { status: "pending" }),
      session.role === "client"
        ? getClientBillingStats(projectId)
        : session.role === "site"
          ? getSiteStockStats(projectId)
          : null,
    ]);

    // Admin's stat row on the web is getPackagesForProject's own totals
    // (BudgetStatBar). The "money" check narrows the query's result type; the
    // ROLE decision above is session.role.
    const stats =
      session.role === "admin" ? (packagesResult.role === "money" ? packagesResult.totals : null) : roleStats;

    return NextResponse.json(
      {
        role: session.role,
        header,
        packages: packagesResult.packages,
        latestUpdates: updatesPage.items.slice(0, LATEST_UPDATES),
        pendingApprovals: approvals.slice(0, PENDING_APPROVALS),
        pendingRequests: requests ? requests.slice(0, PENDING_REQUESTS) : null,
        stats,
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    // { error, message } with mapDomainError's copy (lib/mobile/api.ts): a raw
    // Postgres message never leaves the server; the log gets it, tagged with
    // the reference the caller sees.
    return mobileErrorFrom(e);
  }
}
