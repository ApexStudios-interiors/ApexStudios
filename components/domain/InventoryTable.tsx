import type { InventoryItemDTO } from "@/features/inventory/queries";
import { formatINR } from "@/lib/money";
import { StockLevelBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";

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
}: {
  items: InventoryItemDTO[];
  isAdmin: boolean;
  showProject?: boolean;
}) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Item</th>
          {showProject && <th className={th}>Project</th>}
          <th className={thNum}>On Hand</th>
          <th className={thNum}>Reorder Level</th>
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
                  {i.stockValue != null ? formatINR(i.stockValue) : <span className="text-muted-foreground">–</span>}
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
            <td className={td} colSpan={showProject ? 7 : 6}>
              <Empty>No inventory recorded yet.</Empty>
            </td>
          </tr>
        )}
      </tbody>
    </TableWrap>
  );
}
