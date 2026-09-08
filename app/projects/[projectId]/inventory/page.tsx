"use client";

import { useParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { fmt, fmtS, inventoryFor, inventoryStatus, inventoryValue } from "@/lib/logic";
import { InventoryStatusBadge } from "@/components/domain/StatusBadges";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";

export default function InventoryPage() {
  const params = useParams<{ projectId: string }>();
  const { data } = useApp();
  const project = data.projects.find((p) => p.id === params.projectId)!;
  const items = inventoryFor(data, project.id);

  const totalValue = items.reduce((a, i) => a + inventoryValue(i), 0);
  const lowCount = items.filter((i) => inventoryStatus(i) === "Low").length;
  const criticalCount = items.filter((i) => inventoryStatus(i) === "Critical").length;

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Inventory</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">Material on hand at site.</p>
      </div>

      <StatBar
        stats={[
          { label: "Total Items", value: items.length },
          { label: "Total Value", value: fmtS(totalValue), sub: "at unit cost" },
          { label: "Low Stock", value: lowCount, sub: "below reorder level" },
          { label: "Critical", value: criticalCount, sub: "out of stock" },
        ]}
      />

      <Card>
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Item</th>
              <th className={thNum}>On Hand</th>
              <th className={thNum}>Reorder Level</th>
              <th className={thNum}>Value</th>
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
                    <span className={sub}>{i.category}</span>
                  </td>
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
              ))
            ) : (
              <tr>
                <td className={td} colSpan={6}>
                  <Empty>No inventory recorded yet.</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
