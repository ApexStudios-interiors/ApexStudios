"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { Spinner } from "@/components/ui/spinner";

const ITEMS = [
  { key: "", label: "All" },
  { key: "low", label: "Low" },
  { key: "critical", label: "Critical" },
];

/**
 * The Inventory pages' stock-status filter (APX-51) — `PackageStatusTabs`'
 * pattern: writes `status` into the CURRENT params (so the project filter and
 * the search survive it), drops `page` so a new filter starts on page 1, and
 * lets the Server Component re-read it. The Low Stock and Critical tiles link
 * to the same `?status=` values.
 */
export function InventoryStatusTabs({ status }: { status: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const navigate = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("status", next);
    else params.delete("status");
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  return (
    <>
      <Tabs items={ITEMS} value={status} onChange={navigate} />
      {isPending && <Spinner className="mb-4 text-muted-foreground" />}
    </>
  );
}
