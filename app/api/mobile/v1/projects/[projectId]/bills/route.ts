import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileError, mobileErrorFrom, mobileNotFound } from "@/lib/mobile/api";
import { requireProjectAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/routing/slug";
import { env } from "@/lib/env";
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination";
import { getBillsPageForAdmin, getBillsPageForClient } from "@/features/billing/queries";
import { billingUnavailable, requireBillingSession, toMobileBillSummary } from "@/features/billing/mobile";

/**
 * GET /api/mobile/v1/projects/:projectId/bills[?page=N] — the project's
 * bills, newest first, one page at a time: the web Billing page's own table
 * (app/(app)/projects/[projectId]/billing/page.tsx) through its own queries —
 * getBillsPageForAdmin (`bills`, with cost and margin) for an admin,
 * getBillsPageForClient (`v_bill_client`, drafts excluded, no internal
 * columns) for a client. Every figure is the query's; nothing is computed.
 *
 * Bearer only. Admin and client (`viewBilling`); site is 403. The project
 * must be the user's (requireProjectAccess, 403). Off entirely while
 * `BILLING_ENABLED` is off — 404, as the web page's own `notFound()`.
 * A malformed project id is 404 before any read; a bad `page` is 400.
 */
export const dynamic = "force-dynamic";

/** One of the web table's own page sizes (lib/pagination), fixed. */
const PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 25;
/** Far past any real project's bill count; a bigger page is refused. */
const MAX_PAGE = 1000;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { role, session } = await requireBillingSession();
    if (!env.BILLING_ENABLED) return billingUnavailable();

    const { projectId } = await params;
    if (!isUuid(projectId)) return mobileNotFound();

    const rawPage = new URL(request.url).searchParams.get("page");
    if (rawPage !== null && !(/^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= MAX_PAGE)) {
      return mobileError(400, "VALIDATION", `page must be a whole number from 1 to ${MAX_PAGE}.`);
    }
    const pageRequest = { page: rawPage === null ? 1 : Number(rawPage), pageSize: PAGE_SIZE };

    // Admin passes implicitly; a client needs a project_members row (403).
    await requireProjectAccess(session, projectId);

    const page =
      role === "admin"
        ? await getBillsPageForAdmin(projectId, pageRequest)
        : await getBillsPageForClient(projectId, pageRequest);

    return NextResponse.json(
      {
        // The role the data is shaped for — the only role the app branches on.
        role,
        bills: page.rows.map((b) => toMobileBillSummary(b, role)),
        total: page.total,
        page: page.page,
        pageSize: page.pageSize,
        hasMore: page.page * page.pageSize < page.total,
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    return mobileErrorFrom(e);
  }
}
