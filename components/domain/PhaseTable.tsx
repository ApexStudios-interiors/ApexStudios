"use client";

import { useApp } from "@/context/AppContext";
import type { ModuleT, Project } from "@/lib/types";
import { committed, fmt, isClientRole, isMoney } from "@/lib/logic";
import { Bar } from "@/components/ui/Bar";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, trTotal } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";

export function PhaseTable({ project, module }: { project: Project; module: ModuleT }) {
  const { data, role } = useApp();
  const money = isMoney(role);
  const client = isClientRole(role);
  const c = committed(data, project.id, module);

  if (!module.packages.length) return <Empty>No phases yet.</Empty>;

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Phase</th>
          {money ? (
            <>
              <th className={thNum}>Allocated</th>
              <th className={thNum}>Internal</th>
              <th className={thNum}>Committed</th>
              <th className={thNum}>Remaining</th>
              <th className={th}>Used</th>
            </>
          ) : client ? (
            <th className={thNum}>Contract Value</th>
          ) : (
            <th className={th}>Requests</th>
          )}
        </tr>
      </thead>
      <tbody>
        {module.packages.map((k) => {
          const kc = committed(data, project.id, module, k.id);
          const rq = data.requests.filter(
            (r) => r.proj === project.id && r.mod === module.id && r.pkg === k.id
          ).length;
          return (
            <tr key={k.id}>
              <td className={td}>{k.name}</td>
              {money || client ? (
                <td className={tdNum}>{fmt(k.alloc)}</td>
              ) : (
                <td className={td}>{rq || <span className="text-muted-foreground">–</span>}</td>
              )}
              {money && (
                <>
                  <td className={tdNum}>{fmt(k.int)}</td>
                  <td className={tdNum}>{kc ? fmt(kc) : <span className="text-muted-foreground">–</span>}</td>
                  <td className={tdNum + (k.int - kc < 0 ? " font-bold" : "")}>{fmt(k.int - kc)}</td>
                  <td className={td}>
                    <Bar value={kc} of={k.int} />
                  </td>
                </>
              )}
            </tr>
          );
        })}
        {money ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{fmt(module.packages.reduce((a, k) => a + k.alloc, 0))}</td>
            <td className={tdNum}>{fmt(module.packages.reduce((a, k) => a + k.int, 0))}</td>
            <td className={tdNum}>{fmt(c)}</td>
            <td className={tdNum}>{fmt(module.internal - c)}</td>
            <td className={td}>
              <Bar value={c} of={module.internal} />
            </td>
          </tr>
        ) : client ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{fmt(module.packages.reduce((a, k) => a + k.alloc, 0))}</td>
          </tr>
        ) : null}
      </tbody>
    </TableWrap>
  );
}
