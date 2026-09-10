"use client";

import { useRouter } from "next/navigation";

/**
 * The one client boundary on the project-level Daily Updates page — a
 * native `<select>` that navigates on change. Everything else on that page
 * (the data, the pagination) is a plain Server Component reading
 * `searchParams`.
 */
export function PackageFilterSelect({
  basePath,
  packages,
  value,
}: {
  basePath: string;
  packages: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  return (
    <select
      value={value}
      onChange={(e) => router.push(e.target.value ? `${basePath}?package=${e.target.value}` : basePath)}
      className="h-9 border border-input rounded-lg bg-background px-2 text-[13px]"
    >
      <option value="">All packages</option>
      {packages.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
