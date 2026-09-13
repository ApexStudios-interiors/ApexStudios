import { forbidden, notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getProjectHeader } from "@/features/projects/queries";
import {
  getAdminBillingStats,
  getBillsForAdmin,
  getBillsForClient,
  getClientBillsStats,
} from "@/features/billing/queries";
import { BillingAdmin } from "@/components/domain/BillingAdmin";
import { BillingClient } from "@/components/domain/BillingClient";

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
export default async function BillingPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!env.BILLING_ENABLED) notFound();

  const { projectId } = await params;
  const session = await requireSession();
  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "site") forbidden();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  if (effectiveRole === "client") {
    const [bills, stats] = await Promise.all([getBillsForClient(projectId), getClientBillsStats(projectId)]);
    return <BillingClient bills={bills} stats={stats} />;
  }

  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select(
      "gst_rate_pct, retention_pct, tds_pct, mobilisation_advance, mobilisation_recovered, mobilisation_recovery_pct"
    )
    .eq("id", projectId)
    .single();
  if (error) throw new Error(error.message);

  const [bills, stats] = await Promise.all([getBillsForAdmin(projectId), getAdminBillingStats(projectId)]);

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
        mobilisationAdvance: Number(project.mobilisation_advance),
        mobilisationRecovered: Number(project.mobilisation_recovered),
        mobilisationRecoveryPct: Number(project.mobilisation_recovery_pct),
      }}
    />
  );
}
