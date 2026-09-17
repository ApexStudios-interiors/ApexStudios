"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** `PackageFilterSelect`'s own pattern (Build 06), for the business-wide
 *  inventory page's project filter — a client boundary that writes to the URL
 *  and lets the Server Component re-read it. On shadcn's Select (Base UI)
 *  rather than a native `<select>` so it sits flush beside
 *  `InventorySearchInput` as one toolbar.
 *
 *  Merges `project` into the CURRENT params instead of rebuilding the query
 *  string from this one value — the hard-coded `?project=…` it used to push
 *  dropped the search box's `q` the moment a project was picked. */

/** Base UI wants a real value per item, so "no project filter" is the empty
 *  string rather than `null`; it is also what the page reads back out of
 *  `searchParams`, so the round trip needs no special case. */
const ALL_PROJECTS = "";

export function InventoryProjectFilterSelect({
  projects,
  value,
}: {
  projects: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `items` is what Select.Value reads to render the selected label — without
  // it the trigger would show the raw project id.
  const items = [
    { label: "All projects", value: ALL_PROJECTS },
    ...projects.map((p) => ({ label: p.name, value: p.id })),
  ];

  return (
    <Select
      items={items}
      value={value}
      // `null` is Base UI's "nothing selected"; it can only arrive if the
      // selection is cleared programmatically, and means the same as All.
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams);
        if (next) params.set("project", next);
        else params.delete("project");
        // A changed filter restarts pagination — a stale cursor would
        // otherwise be carried into a freshly filtered, differently-paged
        // list (`PackageFilterSelect`'s own reasoning).
        params.delete("cursor");
        const qs = params.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      }}
    >
      <SelectTrigger className="w-[190px]" aria-label="Filter by project">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value || "all"} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
