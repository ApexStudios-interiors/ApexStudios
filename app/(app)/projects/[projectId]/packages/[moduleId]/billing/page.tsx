import { forbidden, notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getPhaseBillingStatus, getMaterialAtSite } from "@/features/billing/queries";
import { MilestoneTable } from "@/components/domain/MilestoneTable";

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

  const [phases, materials] = await Promise.all([getPhaseBillingStatus(moduleId), getMaterialAtSite(moduleId)]);
  return <MilestoneTable phases={phases} materials={materials} />;
}
