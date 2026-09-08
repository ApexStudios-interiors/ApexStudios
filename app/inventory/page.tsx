"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { fmtS, inventoryStatus, inventoryValue } from "@/lib/logic";
import { InventoryTable } from "@/components/domain/InventoryTable";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";

export default function BusinessInventoryPage() {
  const { data } = useApp();
  const [projectFilter, setProjectFilter] = useState("all");

  const items = data.inventory.filter((i) => projectFilter === "all" || i.proj === projectFilter);

  const totalValue = items.reduce((a, i) => a + inventoryValue(i), 0);
  const lowCount = items.filter((i) => inventoryStatus(i) === "Low").length;
  const criticalCount = items.filter((i) => inventoryStatus(i) === "Critical").length;

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Inventory</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">Material on hand across every project.</p>
      </div>

      <StatBar
        stats={[
          { label: "Total Items", value: items.length },
          { label: "Total Value", value: fmtS(totalValue), sub: "at unit cost" },
          { label: "Low Stock", value: lowCount, sub: "below reorder level" },
          { label: "Critical", value: criticalCount, sub: "out of stock" },
        ]}
      />

      <div className="flex gap-3 mb-4">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-9 border border-input rounded-lg bg-background px-2 text-[13px]"
        >
          <option value="all">All projects</option>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <InventoryTable items={items} projects={data.projects} />
      </Card>
    </div>
  );
}
