"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * A client boundary on any page with a package filter — a native `<select>`
 * that navigates on change. Everything else on that page (the data, the
 * pagination) is a plain Server Component reading `searchParams`.
 *
 * Reads the CURRENT search params and merges `package` into them, rather
 * than rebuilding the query string from just this one value — found live
 * via review: the Daily Updates page (Build 06, this component's original
 * caller) has only this one filter, so a fixed `?package=...` string never
 * lost anything; the Stock page (Build 07) stacks this alongside
 * `StockStatusTabs`'s own `status` param, and changing Package used to
 * silently drop whatever status tab was selected.
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
  const searchParams = useSearchParams();
  return (
    <select
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams);
        if (e.target.value) params.set("package", e.target.value);
        else params.delete("package");
        // A changed filter restarts pagination — the Daily Updates page
        // (this component's original caller) has its own `cursor` param
        // that a stale value would otherwise carry into a freshly filtered,
        // differently-paged list.
        params.delete("cursor");
        const qs = params.toString();
        router.push(qs ? `${basePath}?${qs}` : basePath);
      }}
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
