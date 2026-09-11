"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";

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
 * change and vice versa.
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
  const navigate = (nextStatus: string) => {
    const params = new URLSearchParams();
    if (nextStatus) params.set("status", nextStatus);
    if (packageId) params.set("package", packageId);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };
  return <Tabs items={STATUSES} value={status} onChange={navigate} />;
}
