"use client";

import { useApp } from "@/context/AppContext";
import { useProject } from "@/hooks/useProject";
import { fmtS, inventoryFor, inventoryStatus, inventoryValue } from "@/lib/logic";
import { InventoryTable } from "@/components/domain/InventoryTable";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";

export default function InventoryPage() {
  const { data } = useApp();
  const project = useProject();
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
        <InventoryTable items={items} />
      </Card>
    </div>
  );
}
