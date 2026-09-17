"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { Spinner } from "@/components/ui/spinner";

const STATUSES = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "ordered", label: "Ordered" },
  { key: "delivered", label: "Delivered" },
  { key: "rejected", label: "Rejected" },
];

/**
 * The status-filter half of `PackageFilterSelect`'s own pattern (Build 06):
 * a thin client boundary that navigates on change, everything else on the
 * page stays a plain Server Component reading `searchParams`. Query string
 * key is `status`; `packageId` (if present) is preserved across a status
 * change and vice versa. `page` is dropped, so a new status starts on page 1;
 * the chosen `pageSize` is kept.
 */
export function StockStatusTabs({
  basePath,
  status,
  packageId,
}: {
  basePath: string;
  status: string;
  packageId?: string;
}) {
  const router = useRouter();
  const pageSize = useSearchParams().get("pageSize");
  const [isPending, startTransition] = useTransition();
  const navigate = (nextStatus: string) => {
    const params = new URLSearchParams();
    if (nextStatus) params.set("status", nextStatus);
    if (packageId) params.set("package", packageId);
    if (pageSize) params.set("pageSize", pageSize);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath));
  };
  return (
    <>
      <Tabs items={STATUSES} value={status} onChange={navigate} />
      {isPending && <Spinner className="mb-4 text-muted-foreground" />}
    </>
  );
}
