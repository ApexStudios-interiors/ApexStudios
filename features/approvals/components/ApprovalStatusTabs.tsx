"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { Spinner } from "@/components/ui/spinner";

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
 *
 * `page` is dropped, so a new status starts on page 1; the chosen `pageSize`
 * is kept.
 */
export function ApprovalStatusTabs({ basePath, status }: { basePath: string; status: string }) {
  const router = useRouter();
  const pageSize = useSearchParams().get("pageSize");
  const [isPending, startTransition] = useTransition();
  const navigate = (nextStatus: string) => {
    const sizeParam = pageSize ? `&pageSize=${encodeURIComponent(pageSize)}` : "";
    startTransition(() => router.push(`${basePath}?status=${nextStatus}${sizeParam}`));
  };
  return (
    <>
      <Tabs items={STATUSES} value={status} onChange={navigate} />
      {isPending && <Spinner className="ml-2 inline-block align-middle text-muted-foreground" />}
    </>
  );
}
