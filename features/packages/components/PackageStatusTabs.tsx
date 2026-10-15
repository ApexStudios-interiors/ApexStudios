"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { Spinner } from "@/components/ui/spinner";

/**
 * The Packages page's status filter — `StockStatusTabs`'s own pattern: a thin
 * client boundary that writes `status` to the URL; the page stays a Server
 * Component reading `searchParams`. The search term (`q`) is kept across a
 * status change. `items` come from `packageStatusOptions`: "All" plus only
 * the statuses this project's packages have.
 */
export function PackageStatusTabs({
  items,
  status,
}: {
  items: { key: string; label: string }[];
  status: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const navigate = (nextStatus: string) => {
    const params = new URLSearchParams(searchParams);
    if (nextStatus) params.set("status", nextStatus);
    else params.delete("status");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  return (
    <>
      <Tabs items={items} value={status} onChange={navigate} />
      {isPending && <Spinner className="mb-4 text-muted-foreground" />}
    </>
  );
}
