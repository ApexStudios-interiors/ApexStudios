"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Fragment, useState } from "react";
import { useApp } from "@/context/AppContext";
import { Icon, IconName } from "@/components/ui/Icon";
import { initials } from "@/lib/logic";
import { ALLOWED_SECTIONS, Section, sectionFromPath } from "@/lib/nav";

const NAV_ITEMS: { key: Section; label: string; icon: IconName; href: (id: string) => string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "dash", href: (id) => `/projects/${id}` },
  { key: "packages", label: "Packages", icon: "mod", href: (id) => `/projects/${id}/packages` },
  { key: "schedule", label: "Schedule", icon: "cal", href: (id) => `/projects/${id}/schedule` },
  { key: "updates", label: "Daily Updates", icon: "note", href: (id) => `/projects/${id}/updates` },
  { key: "stock", label: "Stock Requests", icon: "box", href: (id) => `/projects/${id}/stock` },
  { key: "approvals", label: "Approvals", icon: "check", href: (id) => `/projects/${id}/approvals` },
  { key: "billing", label: "Billing", icon: "bill", href: (id) => `/projects/${id}/billing` },
];

export function Sidebar() {
  const { data, role, lastProjectId } = useApp();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string; moduleId?: string }>();
  const [modsOpen, setModsOpen] = useState(true);

  const projectId = params?.projectId || lastProjectId;
  const project = data.projects.find((p) => p.id === projectId) || data.projects[0];
  const isHome = pathname === "/";

  const pend = data.requests.filter((r) => r.proj === project.id && r.status === "Pending").length;
  const apPend = data.approvals.filter((a) => a.proj === project.id && a.status === "Pending").length;
  const billPend = data.bills.filter((b) => b.proj === project.id && b.status === "Submitted").length;
  const allowed = ALLOWED_SECTIONS[role];
  const activeKey = params?.projectId ? sectionFromPath(pathname, params.projectId) : null;

  const user = data.team.find((t) => t.r === role)!;

  return (
    <aside className="bg-sidebar border-r border-border flex flex-col sticky top-0 self-start h-screen overflow-auto p-3">
      <div className="shrink-0 flex items-center gap-2.5 px-1.5 pt-1.5 pb-4">
        <div className="w-[30px] h-[30px] rounded-[7px] bg-primary text-primary-foreground grid place-items-center font-bold text-[13px]">
          A
        </div>
        <div>
          <div className="font-bold text-sm leading-tight">Apex Projects</div>
          <div className="text-[11.5px] text-muted-foreground">app.beapex.in</div>
        </div>
      </div>

      <Link
        href="/"
        className={`shrink-0 flex items-center gap-2.5 w-full text-left border-0 border-b border-border bg-transparent rounded-none px-2 pt-2 pb-3 mb-2.5 cursor-pointer font-semibold text-[13.5px] ${
          isHome ? "text-foreground" : "text-foreground hover:opacity-70"
        }`}
      >
        <Icon name="folder" className="w-4 h-4" />
        All Projects
      </Link>

      <div className="shrink-0 text-[13px] font-bold px-2 pt-2 pb-1.5 truncate" title={project.name}>
        {project.name}
      </div>

      <nav className="shrink-0 flex flex-col gap-px">
        {NAV_ITEMS.filter((it) => allowed.includes(it.key)).map((it) => {
          const on = activeKey === it.key;
          const badge =
            it.key === "stock" && pend && role !== "client"
              ? pend
              : it.key === "approvals" && apPend && role === "client"
              ? apPend
              : it.key === "billing" && billPend && role === "client"
              ? billPend
              : 0;
          const label = it.key === "billing" ? (role === "client" ? "Bills" : "Billing") : it.label;
          return (
            <Fragment key={it.key}>
              <Link
                href={it.href(project.id)}
                className={`flex items-center gap-2.5 w-full text-left border-0 rounded-md px-2 py-[7px] cursor-pointer text-[13.5px] ${
                  on ? "bg-accent font-semibold text-foreground" : "font-medium text-foreground hover:bg-accent"
                }`}
              >
                <Icon name={it.icon} className={`w-4 h-4 flex-none ${on ? "text-foreground" : "text-muted-foreground"}`} />
                {label}
                {badge ? (
                  <span className="ml-auto text-[11px] font-semibold bg-primary text-primary-foreground rounded-full min-w-[18px] h-[18px] px-1.5 grid place-items-center">
                    {badge}
                  </span>
                ) : null}
                {it.key === "packages" ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setModsOpen((v) => !v);
                    }}
                    className="ml-auto w-[26px] h-[26px] grid place-items-center rounded hover:bg-border text-muted-foreground"
                  >
                    <Icon name="chevronRight" className={`w-3.5 h-3.5 transition-transform ${modsOpen ? "rotate-90" : ""}`} />
                  </span>
                ) : null}
              </Link>
              {it.key === "packages" &&
                modsOpen &&
                project.modules.map((m, i) => (
                  <Link
                    key={m.id}
                    href={`/projects/${project.id}/packages/${m.id}`}
                    className={`flex items-center gap-2.5 w-full text-left border-0 rounded-md pl-[34px] pr-2 py-[7px] cursor-pointer text-[13.5px] ${
                      params?.moduleId === m.id ? "text-foreground font-medium bg-accent" : "text-muted-foreground font-normal hover:bg-accent"
                    }`}
                  >
                    <span className="inline-block min-w-[22px] text-muted-foreground tabular-nums font-medium">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {m.name}
                  </Link>
                ))}
            </Fragment>
          );
        })}
      </nav>

      {role === "admin" && (
        <div className="shrink-0">
          <div className="text-[11px] font-semibold text-muted-foreground px-2 pt-3.5 pb-1.5 uppercase tracking-wider">
            Studio
          </div>
          <Link
            href="/users"
            className={`flex items-center gap-2.5 w-full text-left border-0 rounded-md px-2 py-[7px] cursor-pointer text-[13.5px] ${
              pathname === "/users" ? "bg-accent font-semibold text-foreground" : "font-medium text-foreground hover:bg-accent"
            }`}
          >
            <Icon name="users" className={`w-4 h-4 flex-none ${pathname === "/users" ? "text-foreground" : "text-muted-foreground"}`} />
            Users
          </Link>
        </div>
      )}

      <div className="shrink-0 mt-auto flex items-center gap-2.5 pt-3 pb-1 px-2 border-t border-border">
        <div className="w-[30px] h-[30px] rounded-full bg-muted grid place-items-center text-[11.5px] font-semibold">
          {initials(user.n)}
        </div>
        <div>
          <div className="font-semibold text-[13px] leading-tight">{user.n}</div>
          <div className="text-[11.5px] text-muted-foreground">{user.t}</div>
        </div>
      </div>
    </aside>
  );
}
