import { forbidden, notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getProjectHeader } from "@/features/projects/queries";
import {
  getAdminBillingStats,
  getBillsPageForAdmin,
  getBillsPageForClient,
  getClientBillsStats,
} from "@/features/billing/queries";
import { parsePageRequest } from "@/lib/pagination";
import { BillingAdmin } from "@/features/billing/components/BillingAdmin";
import { BillingClient } from "@/features/billing/components/BillingClient";

/**
 * build/09-billing.md §4.5. Site has no billing access at all (ui-guide
 * §6.11/§7.1's own matrix — `viewBilling: owner, admin, client`) —
 * `forbidden()`, not an empty state, same as `/stock`'s own client gate in
 * Build 07.
 *
 * `BILLING_ENABLED` (build §4.8): off in production until a CA has signed
 * off on a generated bill — `notFound()`, the same honest "this route
 * doesn't exist yet" framing the rest of this app gives an unbuilt page,
 * not a "coming soon" that invites a curious client to keep checking.
 */
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  if (!env.BILLING_ENABLED) notFound();

  const { projectId } = await params;
  const pageRequest = parsePageRequest(await searchParams);
  const session = await requireSession();
  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "site") forbidden();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  if (effectiveRole === "client") {
    const [bills, stats] = await Promise.all([
      getBillsPageForClient(projectId, pageRequest),
      getClientBillsStats(projectId),
    ]);
    return <BillingClient bills={bills} stats={stats} />;
  }

  const supabase = await createClient();
  // mobilisation_advance / _recovered are not selectable on projects
  // (APX-09: site must never read them) — they come from v_project_finance.
  const [{ data: project, error }, { data: finance, error: financeErr }] = await Promise.all([
    supabase
      .from("projects")
      .select("gst_rate_pct, retention_pct, tds_pct, mobilisation_recovery_pct")
      .eq("id", projectId)
      .single(),
    supabase
      .from("v_project_finance")
      .select("mobilisation_advance, mobilisation_recovered")
      .eq("id", projectId)
      .maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (financeErr) throw new Error(financeErr.message);

  const [bills, stats] = await Promise.all([
    getBillsPageForAdmin(projectId, pageRequest),
    getAdminBillingStats(projectId),
  ]);

  return (
    <BillingAdmin
      projectId={projectId}
      clientName={header.client}
      bills={bills}
      stats={stats}
      rates={{
        gstRatePct: Number(project.gst_rate_pct),
        retentionPct: Number(project.retention_pct),
        tdsPct: Number(project.tds_pct),
        mobilisationAdvance: Number(finance?.mobilisation_advance ?? 0),
        mobilisationRecovered: Number(finance?.mobilisation_recovered ?? 0),
        mobilisationRecoveryPct: Number(project.mobilisation_recovery_pct),
      }}
    />
  );
}
