"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";

/** `docs/ui-guide.md` §6.10: "Status filter tabs: Pending / Approved /
 *  Rejected / All" — that exact order, matching the mock's own `FILTERS`
 *  array and its "Pending" default, unlike `StockStatusTabs`'s "All" first. */
const STATUSES = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "", label: "All" },
];

/**
 * Same thin-client-boundary-navigates-on-change pattern as `StockStatusTabs`
 * (Build 07) — the page itself stays a plain Server Component reading
 * `searchParams`. Query string key is `status`.
 *
 * "All" always sends an EXPLICIT `?status=`, never a bare `basePath` —
 * found live via the client journey's own Playwright test: dropping the
 * param entirely made the page's own "absent means never visited, default
 * to pending" rule (necessary so a fresh visit to `/approvals` opens on
 * Pending, not All) indistinguishable from "explicitly cleared to All",
 * silently bouncing the tab back to Pending instead of showing every row.
 */
export function ApprovalStatusTabs({ basePath, status }: { basePath: string; status: string }) {
  const router = useRouter();
  const navigate = (nextStatus: string) => {
    router.push(`${basePath}?status=${nextStatus}`);
  };
  return <Tabs items={STATUSES} value={status} onChange={navigate} />;
}
