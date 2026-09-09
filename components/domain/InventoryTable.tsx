import type { InventoryItem, Project } from "@/lib/types";
import { fmt, inventoryStatus, inventoryValue } from "@/lib/logic";
import { InventoryStatusBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";

export function InventoryTable({ items, projects }: { items: InventoryItem[]; projects?: Project[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Item</th>
          {projects && <th className={th}>Project</th>}
          <th className={thNum}>On Hand</th>
          <th className={thNum}>Reorder Level</th>
          <th className={thNum}>Value</th>
          <th className={th}>Location</th>
          <th className={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.length ? (
          items.map((i) => {
            const project = projects?.find((p) => p.id === i.proj);
            return (
              <tr key={i.id}>
                <td className={td}>
                  {i.name}
                  <span className={sub}>{i.category}</span>
                </td>
                {projects && <td className={td + " text-muted-foreground"}>{project?.name ?? i.proj}</td>}
                <td className={tdNum}>
                  {i.qty.toLocaleString("en-IN")} {i.unit}
                </td>
                <td className={tdNum}>
                  {i.reorderLevel.toLocaleString("en-IN")} {i.unit}
                </td>
                <td className={tdNum}>{fmt(inventoryValue(i))}</td>
                <td className={td + " text-muted-foreground"}>{i.location}</td>
                <td className={td}>
                  <InventoryStatusBadge status={inventoryStatus(i)} />
                </td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td className={td} colSpan={projects ? 7 : 6}>
              <Empty>No inventory recorded yet.</Empty>
            </td>
          </tr>
        )}
      </tbody>
    </TableWrap>
  );
}
