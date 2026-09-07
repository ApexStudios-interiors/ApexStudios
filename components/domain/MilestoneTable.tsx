"use client";

import { useApp } from "@/context/AppContext";
import { ModuleT, Project } from "@/lib/types";
import { amt, factor, fmt, isMoney, phStatus, phTasks } from "@/lib/logic";
import { MAS } from "@/lib/data";
import { PhaseStatusBadge } from "@/components/domain/StatusBadges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, trTotal, sub } from "@/components/ui/table";
import { Card, CardHeader } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";

export function MilestoneTable({ project, module }: { project: Project; module: ModuleT }) {
  const { data, role, markPhaseDone } = useApp();
  const ks = module.packages;
  const money = isMoney(role);
  const materials = data.requests.filter((r) => r.proj === project.id && r.mod === module.id && r.status === "Delivered" && amt(r) > 0);

  return (
    <>
      <Card>
        {ks.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Phase</th>
                <th className={th}>Tasks</th>
                <th className={thNum}>Bill Amount</th>
                <th className={th}>Status</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {ks.map((k) => {
                const st = phStatus(data, module, k);
                const ts = phTasks(module, k);
                const done = ts.filter((t) => t.p === 100).length;
                const b = k.billedIn ? data.bills.find((x) => x.id === k.billedIn) : null;
                return (
                  <tr key={k.id}>
                    <td className={td}>{k.name}</td>
                    <td className={td + " text-muted-foreground text-sm"}>{ts.length ? `${done} of ${ts.length} done` : "No tasks linked"}</td>
                    <td className={tdNum}>{fmt(k.alloc)}</td>
                    <td className={td}>
                      <PhaseStatusBadge status={st} />
                      {b && <span className={sub + " text-xs"}>{b.id}</span>}
                    </td>
                    <td className={td} style={{ textAlign: "right" }}>
                      {st === "Pending" && !ts.length && money ? (
                        <Button size="sm" onClick={() => markPhaseDone(project.id, module.id, k.id)}>
                          Mark Complete
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              <tr className={trTotal}>
                <td className={td}>Total</td>
                <td className={td} />
                <td className={tdNum}>{fmt(ks.reduce((a, k) => a + k.alloc, 0))}</td>
                <td className={td} />
                <td className={td} />
              </tr>
            </tbody>
          </TableWrap>
        ) : (
          <Empty>No phases yet.</Empty>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <h3>Material at Site</h3>
        </CardHeader>
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Material</th>
              <th className={thNum}>Cost</th>
              <th className={thNum}>Client Value</th>
              <th className={thNum}>Billable ({MAS}%)</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {materials.length ? (
              materials.map((r) => {
                const cv = Math.round(amt(r) * factor(module, r.pkg));
                const b = r.billedIn ? data.bills.find((x) => x.id === r.billedIn) : null;
                return (
                  <tr key={r.id}>
                    <td className={td}>
                      {r.item}
                      <span className={sub}>
                        {r.id} · {r.qty} {r.unit}
                      </span>
                    </td>
                    <td className={tdNum}>{fmt(amt(r))}</td>
                    <td className={tdNum}>{fmt(cv)}</td>
                    <td className={tdNum}>{fmt(Math.round((cv * MAS) / 100))}</td>
                    <td className={td}>
                      {b ? (
                        <Badge variant={b.status === "Paid" ? "default" : "outline"}>
                          {b.id} · {b.status}
                        </Badge>
                      ) : (
                        <Badge variant="outline">● Billable</Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className={td} colSpan={5}>
                  <Empty>Nothing delivered yet.</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
