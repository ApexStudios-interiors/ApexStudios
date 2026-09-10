"use client";

import { useApp } from "@/context/AppContext";
import { DialogShell } from "@/components/ui/DialogShell";
import { BillStatusBadge } from "@/components/domain/StatusBadges";
import { BillFiles } from "@/components/domain/BillFiles";
import { billTotals, dmy, fmt, isClientRole, isMoney, mno, pct } from "@/lib/logic";
import { GST, RET } from "@/lib/data";
import { Button } from "@/components/ui/Button";

function Row({
  label,
  value,
  bold,
  big,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  big?: boolean;
}) {
  return (
    <div
      className={`flex justify-between px-1 border-b border-border text-[13.5px] ${bold ? "font-bold" : ""} ${
        big ? "text-[15px] border-b-0 pt-2.5" : "py-1.5"
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function BillViewDialog({ billId }: { billId: string }) {
  const { data, role, closeDialog, openDialog, toast } = useApp();
  const b = data.bills.find((x) => x.id === billId);
  const project = b ? data.projects.find((p) => p.id === b.proj) : undefined;
  if (!b || !project) return null;
  const t = billTotals(b);
  const client = isClientRole(role);

  return (
    <DialogShell
      title={`Bill ${b.id}`}
      description={
        <>
          {project.client} · {dmy(b.date)} · <BillStatusBadge status={b.status} />
        </>
      }
      okLabel={client ? "Download PDF" : "Download Excel"}
      onClose={closeDialog}
      onOk={() => {
        toast(client ? "PDF downloaded" : "Excel generated in ApexStudios format");
      }}
    >
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr>
              <th className="text-left font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                Description
              </th>
              <th className="text-right font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                Client Value
              </th>
              <th className="text-right font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                %
              </th>
              <th className="text-right font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l, i) => {
              const m = project.modules.find((x) => x.id === l.mod);
              return (
                <tr key={i}>
                  <td className="px-3 py-2.5 border-b border-border last:border-b-0">
                    {l.desc}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {m ? `${mno(project, m)} ${m.name}` : ""}
                      {l.type === "material" ? " · material at site" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 border-b border-border last:border-b-0 text-right">
                    {fmt(l.client)}
                  </td>
                  <td className="px-3 py-2.5 border-b border-border last:border-b-0 text-right">{l.pct}%</td>
                  <td className="px-3 py-2.5 border-b border-border last:border-b-0 text-right">
                    {fmt(Math.round((l.client * l.pct) / 100))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col mt-3.5">
        <Row label="Gross" value={fmt(t.gross)} />
        {b.recovery ? (
          <Row label="Less material at site previously billed" value={"-" + fmt(b.recovery).slice(1)} />
        ) : null}
        <Row label="Taxable value" value={fmt(t.taxable)} bold />
        <Row label={`Less retention ${RET}%`} value={"-" + fmt(t.ret).slice(1)} />
        <Row label={`GST ${GST}%`} value={fmt(t.gst)} />
        <Row label="Net payable" value={fmt(t.net)} bold big />
      </div>

      <div className="mt-3.5 p-3 border border-border rounded-lg">
        <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground mb-1.5">
          Bill copy
        </div>
        {b.files.length ? (
          <BillFiles files={b.files} />
        ) : (
          <span className="text-muted-foreground text-sm">No file uploaded yet.</span>
        )}
        {!client && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                openDialog({ kind: "billUpload", billId: b.id });
              }}
            >
              Upload file
            </Button>
          </div>
        )}
      </div>

      {isMoney(role) && (
        <div className="mt-3.5 p-3 border border-dashed border-border-strong rounded-lg bg-muted/40">
          <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground mb-1">
            Internal · not on the client copy
          </div>
          <Row label="Cost in this bill" value={fmt(t.cost)} />
          <Row
            label="Margin in this bill"
            value={
              <>
                {fmt(t.margin)}{" "}
                <span className="text-muted-foreground text-xs">({pct(t.margin, t.taxable)}%)</span>
              </>
            }
            bold
          />
        </div>
      )}
    </DialogShell>
  );
}
