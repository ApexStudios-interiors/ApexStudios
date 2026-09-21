import type { InventoryItemDTO } from "@/features/inventory/queries";
import { formatINR } from "@/lib/money";
import { StockLevelBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { MinimumStockInfo } from "@/features/inventory/components/MinimumStockInfo";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 5: already props-driven
 * (no `useApp()` here even in the prototype) — only the DTO changes, from the
 * mock `InventoryItem`/`Project` to the real, role-shaped `InventoryItemDTO`.
 * `showProject` replaces the old `projects?` presence check (business-wide
 * view only). `isAdmin` gates the Value column explicitly — inferring it
 * from whether any row happens to carry a non-null `stockValue` breaks on an
 * empty result, so the caller (which already knows the real role) passes it
 * directly. `unitCost`/`stockValue` are already `null` for a non-admin row
 * regardless (features/inventory/queries.ts's own boundary) — the Value
 * column is simply not rendered at all for that role, rather than rendered
 * as "–" (AGENTS.md: never fetch or expose the column in the first place).
 */
export function InventoryTable({
  items,
  isAdmin,
  showProject = false,
  empty = "No inventory recorded yet.",
}: {
  items: InventoryItemDTO[];
  isAdmin: boolean;
  showProject?: boolean;
  /** The empty-state text. A search that matches nothing is not the same
   *  situation as an inventory with nothing in it, and should not say so. */
  empty?: string;
}) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Item</th>
          {showProject && <th className={th}>Project</th>}
          <th className={thNum}>On Hand</th>
          <th className={thNum}>
            Minimum Stock
            <MinimumStockInfo />
          </th>
          {isAdmin && <th className={thNum}>Value</th>}
          <th className={th}>Location</th>
          <th className={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.length ? (
          items.map((i) => (
            <tr key={i.id}>
              <td className={td}>
                {i.name}
                <span className={sub}>{i.category ?? ""}</span>
              </td>
              {showProject && (
                <td className={td + " text-muted-foreground"}>{i.projectName ?? "Central store"}</td>
              )}
              <td className={tdNum}>
                {i.qtyOnHand.toLocaleString("en-IN")} {i.unit}
              </td>
              <td className={tdNum}>
                {i.reorderLevel.toLocaleString("en-IN")} {i.unit}
              </td>
              {isAdmin && (
                <td className={tdNum}>
                  {i.stockValue != null ? (
                    formatINR(i.stockValue)
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              )}
              <td className={td + " text-muted-foreground"}>{i.location ?? "–"}</td>
              <td className={td}>
                <StockLevelBadge status={i.status} />
              </td>
            </tr>
          ))
        ) : (
          <tr>
            {/* 5 base columns (Item, On Hand, Minimum Stock, Location, Status)
                plus Project and/or Value when those are shown — found live
                via review: this stayed keyed on `showProject` alone after
                `isAdmin` was added, under-spanning the empty state for a
                non-admin business-wide view and over-spanning it for a
                non-admin project view. */}
            <td className={td} colSpan={5 + (showProject ? 1 : 0) + (isAdmin ? 1 : 0)}>
              <Empty>{empty}</Empty>
            </td>
          </tr>
        )}
      </tbody>
    </TableWrap>
  );
}
