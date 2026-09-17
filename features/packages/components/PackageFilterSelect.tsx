"use client";

import { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

/**
 * A client boundary on any page with a package filter — a select that
 * navigates on change. Everything else on that page (the data, the
 * pagination) is a plain Server Component reading `searchParams`.
 *
 * Reads the CURRENT search params and merges `package` into them, rather
 * than rebuilding the query string from just this one value — found live
 * via review: the Daily Updates page (Build 06, this component's original
 * caller) has only this one filter, so a fixed `?package=...` string never
 * lost anything; the Stock page (Build 07) stacks this alongside
 * `StockStatusTabs`'s own `status` param, and changing Package used to
 * silently drop whatever status tab was selected.
 *
 * "All packages" is Base UI's `null` item, not the native select's `""`
 * option: Base UI treats `null` as "no selection" and renders a null item's
 * label in the trigger. The `value` prop callers pass stays `""` for "all",
 * so no caller changes.
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
  // Pending while the filtered page is fetched, so the Spinner can show.
  const [isPending, startTransition] = useTransition();
  const items = useMemo(
    () => [{ value: null, label: "All packages" }, ...packages.map((p) => ({ value: p.id, label: p.name }))],
    [packages]
  );
  return (
    <Select
      items={items}
      value={value || null}
      onValueChange={(next: string | null) => {
        const params = new URLSearchParams(searchParams);
        if (next) params.set("package", next);
        else params.delete("package");
        // A changed filter restarts pagination — the Daily Updates page
        // (this component's original caller) has its own `cursor` param
        // that a stale value would otherwise carry into a freshly filtered,
        // differently-paged list.
        params.delete("cursor");
        // Same for the tables' own `page` param (lib/pagination.ts).
        params.delete("page");
        const qs = params.toString();
        startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath));
      }}
    >
      <SelectTrigger aria-label="Package" className="h-9 min-w-40 text-[13px]">
        <SelectValue />
        {isPending && <Spinner className="text-muted-foreground" />}
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value ?? "all"} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
