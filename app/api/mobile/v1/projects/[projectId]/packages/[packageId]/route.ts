import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileErrorFrom, mobileNotFound, requireBearerSession } from "@/lib/mobile/api";
import { requireProjectAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/routing/slug";
import { getPackageDetail, getPackageNavLists, getPhasesForPackage } from "@/features/packages/queries";
import { getScheduleForPackage, type PackageSchedule } from "@/features/schedule/queries";
import { getOwnerOptions } from "@/features/schedule/actions";
import { getUpdatesForProject } from "@/features/updates/queries";
import { getStockRequestsPage } from "@/features/stock/queries";

/**
 * GET /api/mobile/v1/projects/:projectId/packages/:packageId — one package:
 * its detail, phases, schedule, latest updates and (admin/site) pending stock
 * requests — the data behind the web's package tabs
 * (app/(app)/projects/[projectId]/packages/[moduleId]/), minus Billing.
 *
 * Authenticates with `Authorization: Bearer <Supabase access token>` (D67).
 * middleware.ts skips /api/mobile/*, and the web's project layout (where
 * requireProjectAccess runs for the web) does not wrap a route handler, so
 * this route checks project access itself.
 *
 * The package must belong to the project in the URL — for every role. The
 * admin variants of getPackageDetail/getPhasesForPackage look a package up by
 * id alone, so without this check an admin could pair any project with any
 * package. Membership is read from getPackageNavLists — the sidebar's own
 * id+name list, the same role split as every package read (admin: `packages`
 * without deleted rows; otherwise the role's view), filtered by project_id —
 * one light query rather than the whole Packages table with its rollups.
 *
 * Only what is shown is read: the latest five updates (getUpdatesForProject's
 * `limit`), the first five pending requests (getStockRequestsPage, page 1 of
 * the same ordered query), and this package's own schedule rows.
 *
 * Role shaping is the queries' own, unchanged (admin money, client contract
 * value, site neither; site's stock rows money-free). A client gets no stock
 * requests at all — the web's package Stock tab is forbidden() for a client.
 * The top-level `role` is the session's; the queries' "money" tag is not a
 * user role. Billing is not exposed.
 *
 * Bearer only (lib/mobile/api.ts requireBearerSession): a request without an
 * `Authorization: Bearer` header is refused before anything else, so a
 * browser's session cookie can never authorize it. Errors are
 * `{ error, message }`, as on every other mobile route.
 */
export const dynamic = "force-dynamic";

const LATEST_UPDATES = 5;
const PENDING_REQUESTS = 5;

/**
 * The schedule without the web Gantt's presentation fields (viewport,
 * monthHeaders, each task's week positions). A projection only: every value
 * kept is the query's own.
 */
function scheduleForMobile(schedule: PackageSchedule) {
  return {
    packageId: schedule.packageId,
    packageName: schedule.packageName,
    seqNo: schedule.seqNo,
    projectStart: schedule.projectStart,
    progressPct: schedule.progressPct,
    taskCount: schedule.taskCount,
    phases: schedule.phases.map((phase) => ({
      id: phase.id,
      seqNo: phase.seqNo,
      name: phase.name,
      progressPct: phase.progressPct,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        ownerName: task.ownerName,
        startDate: task.startDate,
        durationWeeks: task.durationWeeks,
        endDate: task.endDate,
        progressPct: task.progressPct,
        late: task.late,
        note: task.note,
      })),
    })),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; packageId: string }> }
) {
  try {
    const session = await requireBearerSession();
    const { projectId, packageId } = await params;
    // Not ids at all: the same answer as ids that do not exist, rather than a
    // database error about a malformed uuid.
    if (!isUuid(projectId) || !isUuid(packageId)) return mobileNotFound();
    await requireProjectAccess(session, projectId);

    // Ownership first, before any by-id lookup.
    const navLists = await getPackageNavLists(session, [projectId]);
    if (!(navLists[projectId] ?? []).some((p) => p.id === packageId)) return mobileNotFound();

    const detail = await getPackageDetail(session, projectId, packageId);
    if (!detail) return mobileNotFound();

    const isClient = session.role === "client";
    const [phasesResult, schedule, updatesPage, requests, ownerOptions] = await Promise.all([
      getPhasesForPackage(session, projectId, packageId),
      getScheduleForPackage(session, projectId, packageId),
      getUpdatesForProject(session, projectId, { packageId, limit: LATEST_UPDATES }),
      // The web's package Stock tab is forbidden() for a client — not fetched.
      isClient
        ? null
        : getStockRequestsPage(
            session,
            projectId,
            { status: "pending", packageId },
            { page: 1, pageSize: PENDING_REQUESTS }
          ),
      // The web Add Task dialog's own Owner choices (getOwnerOptions: admin
      // and site staff, "To assign" being no owner) — for the roles that may
      // add a task only; a client never adds one, so never gets the list.
      isClient ? null : getOwnerOptions(),
    ]);

    return NextResponse.json(
      {
        role: session.role,
        package: detail,
        phases: phasesResult.phases,
        // The phase table's own totals: admin's money, client's allocated;
        // site has none.
        phaseTotals: "totals" in phasesResult ? phasesResult.totals : null,
        // null when the project has no start date (the query's own rule).
        schedule: schedule ? scheduleForMobile(schedule) : null,
        latestUpdates: updatesPage.items.slice(0, LATEST_UPDATES),
        pendingRequests: requests ? requests.rows.slice(0, PENDING_REQUESTS) : null,
        // { id, name }[] for admin and site; null for a client.
        ownerOptions,
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
