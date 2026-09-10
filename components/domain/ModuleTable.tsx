"use client";

import Link from "next/link";
import { useApp } from "@/context/AppContext";
import type { AppData, Project } from "@/lib/types";
import { committed, fmt, isMoney, isClientRole, mno, progress, projProgress, totals } from "@/lib/logic";
import { Bar } from "@/components/ui/Bar";
import { ModuleStatusBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, trClick, trTotal, sub } from "@/components/ui/table";

export function ModuleTable({ project }: { project: Project }) {
  const { data, role } = useApp();
  const t = totals(data, project);
  const money = isMoney(role);
  const client = isClientRole(role);
  const openRequests = (data: AppData, m: string) =>
    data.requests.filter(
      (r) => r.proj === project.id && r.mod === m && ["Pending", "Approved", "Ordered"].includes(r.status)
    ).length;

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Package</th>
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
            <>
              <th className={th}>Phases</th>
              <th className={th}>Open Requests</th>
            </>
          )}
          <th className={th}>Progress</th>
          <th className={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {project.modules.map((m) => {
          const c = committed(data, project.id, m);
          return (
            <tr key={m.id} className={trClick}>
              <td className={td}>
                <Link
                  href={`/projects/${project.id}/packages/${m.id}`}
                  className="font-medium hover:underline"
                >
                  <span className="inline-block min-w-[22px] mr-1.5 text-muted-foreground tabular-nums font-medium">
                    {mno(project, m)}
                  </span>
                  {m.name}
                </Link>
                <span className={sub} style={{ paddingLeft: 22 }}>
                  {m.lead}
                </span>
              </td>
              {money || client ? (
                <td className={tdNum}>{fmt(m.allocated)}</td>
              ) : (
                <>
                  <td className={td}>{m.packages.length}</td>
                  <td className={td}>{openRequests(data, m.id)}</td>
                </>
              )}
              {money && (
                <>
                  <td className={tdNum}>{fmt(m.internal)}</td>
                  <td className={tdNum}>{fmt(c)}</td>
                  <td className={tdNum + (m.internal - c < 0 ? " font-bold" : "")}>{fmt(m.internal - c)}</td>
                  <td className={td}>
                    <Bar value={c} of={m.internal} />
                  </td>
                </>
              )}
              <td className={td}>
                <Bar value={progress(m)} of={100} />
              </td>
              <td className={td}>
                <ModuleStatusBadge data={data} projId={project.id} m={m} />
              </td>
            </tr>
          );
        })}
        {money ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{fmt(t.alloc)}</td>
            <td className={tdNum}>{fmt(t.int)}</td>
            <td className={tdNum}>{fmt(t.c)}</td>
            <td className={tdNum}>{fmt(t.int - t.c)}</td>
            <td className={td}>
              <Bar value={t.c} of={t.int} />
            </td>
            <td className={td}>
              <Bar value={projProgress(project)} of={100} />
            </td>
            <td className={td} />
          </tr>
        ) : client ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{fmt(t.alloc)}</td>
            <td className={td}>
              <Bar value={projProgress(project)} of={100} />
            </td>
            <td className={td} />
          </tr>
        ) : null}
      </tbody>
    </TableWrap>
  );
}
