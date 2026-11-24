import type { Session } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { todayIst } from "@/lib/dates";
import { getBillingAttention } from "@/features/billing/queries";
import { getTaskAttention } from "@/features/schedule/queries";
import { getDeliveriesDue } from "@/features/stock/queries";
import { BillingAttentionTiles } from "@/features/billing/components/BillingAttentionTiles";
import { LateTasksCard } from "@/features/schedule/components/LateTasksCard";
import { TodayCard } from "@/features/projects/components/TodayCard";

/**
 * APX-48: the project dashboard's "what needs attention" block, one Server
 * Component so the page itself needs a single line of wiring. Role-scoped on
 * the EFFECTIVE role (so an admin previewing as site sees the site card):
 *
 *   admin   billing tiles (only while BILLING_ENABLED) + Late tasks
 *   site    Today: late / under-way tasks and deliveries due — no money
 *   client  nothing here; their dashboard already leads with what awaits them
 */
export async function DashboardAttention({
  session,
  projectId,
  base,
}: {
  session: Session;
  projectId: string;
  /** Canonical `/projects/<code>` — links built from it cost no redirect. */
  base: string;
}) {
  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "client") return null;
  const today = todayIst();

  if (effectiveRole === "admin") {
    const [billing, tasks] = await Promise.all([
      env.BILLING_ENABLED ? getBillingAttention(projectId) : Promise.resolve(null),
      getTaskAttention(session, projectId),
    ]);
    return (
      <>
        {billing && <BillingAttentionTiles data={billing} billingHref={`${base}/billing`} today={today} />}
        <LateTasksCard
          tasks={tasks.late}
          lateCount={tasks.lateCount}
          scheduleHref={`${base}/schedule`}
          today={today}
        />
      </>
    );
  }

  const [tasks, deliveries] = await Promise.all([
    getTaskAttention(session, projectId),
    getDeliveriesDue(session, projectId, today),
  ]);
  return (
    <TodayCard
      late={tasks.late}
      inProgress={tasks.inProgress}
      deliveries={deliveries}
      scheduleHref={`${base}/schedule`}
      stockHref={`${base}/stock`}
      today={today}
    />
  );
}
