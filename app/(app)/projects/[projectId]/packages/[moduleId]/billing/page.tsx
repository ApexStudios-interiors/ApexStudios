import { forbidden, notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getPhaseBillingStatus, getMaterialAtSite } from "@/features/billing/queries";
import { MilestoneTable } from "@/features/billing/components/MilestoneTable";

/** ui-guide §6.5: "Billing tab (Admin only)." The tab bar itself already
 *  hides this for non-admin (layout.tsx); `forbidden()` is the second,
 *  harder boundary against a direct URL visit. `BILLING_ENABLED` (build
 *  §4.8) gates it the same way the main billing page does. */
export default async function PackageBillingTab({ params }: { params: Promise<{ moduleId: string }> }) {
  if (!env.BILLING_ENABLED) notFound();

  const { moduleId } = await params;
  const session = await requireSession();
  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole !== "owner" && effectiveRole !== "admin") forbidden();

  const supabase = await createClient();
  const [phases, materials, pkg] = await Promise.all([
    getPhaseBillingStatus(moduleId),
    getMaterialAtSite(moduleId),
    // Only `status`, and only so the tab can say that a package marked
    // "completed" is still not billable on that account — billing reads
    // phases, never packages.status.
    supabase.from("packages").select("status").eq("id", moduleId).single(),
  ]);
  if (pkg.error) throw new Error(pkg.error.message);

  return (
    <MilestoneTable
      phases={phases}
      materials={materials}
      packageId={moduleId}
      packageStatus={pkg.data.status}
    />
  );
}
