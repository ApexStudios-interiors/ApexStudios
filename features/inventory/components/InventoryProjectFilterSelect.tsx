"use client";

import { useRouter } from "next/navigation";

/** `PackageFilterSelect`'s own pattern (Build 06), for the business-wide
 *  inventory page's project filter. */
export function InventoryProjectFilterSelect({
  projects,
  value,
}: {
  projects: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  return (
    <select
      value={value}
      onChange={(e) => router.push(e.target.value ? `/inventory?project=${e.target.value}` : "/inventory")}
      className="h-9 border border-input rounded-lg bg-background px-2 text-[13px]"
    >
      <option value="">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
