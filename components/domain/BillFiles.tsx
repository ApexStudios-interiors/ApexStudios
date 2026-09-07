"use client";

import { BillFile } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { useApp } from "@/context/AppContext";

export function BillFiles({ files }: { files: BillFile[] }) {
  const { toast } = useApp();
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {files.map((f, i) => (
        <button
          key={i}
          onClick={() => toast(`Opening ${f.n}`)}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-full text-xs font-medium bg-muted/50 hover:border-ring whitespace-nowrap"
        >
          <Icon name="bill" className="w-3.5 h-3.5" />
          {f.n}
          <em className="not-italic text-muted-foreground font-normal">{f.s}</em>
        </button>
      ))}
    </div>
  );
}
