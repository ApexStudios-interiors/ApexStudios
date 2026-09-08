"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Fragment, useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import { Icon, IconName } from "@/components/ui/Icon";
import { initials } from "@/lib/logic";
import { ALLOWED_SECTIONS, Section, sectionFromPath } from "@/lib/nav";
import { Role } from "@/lib/types";
import { useClickOutside } from "@/hooks/useClickOutside";

const NAV_ITEMS: { key: Section; label: string; icon: IconName; href: (id: string) => string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "dash", href: (id) => `/projects/${id}` },
  { key: "packages", label: "Packages", icon: "mod", href: (id) => `/projects/${id}/packages` },
  { key: "schedule", label: "Schedule", icon: "cal", href: (id) => `/projects/${id}/schedule` },
  { key: "updates", label: "Daily Updates", icon: "note", href: (id) => `/projects/${id}/updates` },
  { key: "inventory", label: "Inventory", icon: "archive", href: (id) => `/projects/${id}/inventory` },
  { key: "stock", label: "Stock Requests", icon: "box", href: (id) => `/projects/${id}/stock` },
  { key: "approvals", label: "Approvals", icon: "check", href: (id) => `/projects/${id}/approvals` },
  { key: "billing", label: "Billing", icon: "bill", href: (id) => `/projects/${id}/billing` },
];

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "site", label: "Site Supervisor" },
  { value: "client", label: "Client" },
];

export function Sidebar() {
  const { data, role, setRole } = useApp();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string; moduleId?: string }>();
  const [modsOpen, setModsOpen] = useState(true);
  const [projectsMenuOpen, setProjectsMenuOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const projectsMenuRef = useRef<HTMLDivElement>(null);
  const roleMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(projectsMenuRef, () => setProjectsMenuOpen(false), projectsMenuOpen);
  useClickOutside(roleMenuRef, () => setRoleMenuOpen(false), roleMenuOpen);

  const isHome = pathname === "/";
  const project = params?.projectId ? data.projects.find((p) => p.id === params.projectId) ?? null : null;
  const allowed = ALLOWED_SECTIONS[role];

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

      <div className="shrink-0 relative mb-2.5" ref={projectsMenuRef}>
        <button
          onClick={() => setProjectsMenuOpen((v) => !v)}
          className={`flex items-center gap-2.5 w-full text-left border-0 border-b rounded-none px-2 pt-2 pb-3 cursor-pointer font-semibold text-[13.5px] text-foreground hover:opacity-70 ${
            isHome ? "border-foreground" : "border-border"
          }`}
        >
          <Icon name="folder" className="w-4 h-4" />
          All Projects
          <Icon
            name="chevronRight"
            className={`w-3.5 h-3.5 ml-auto text-muted-foreground transition-transform ${projectsMenuOpen ? "rotate-90" : ""}`}
          />
        </button>
        {projectsMenuOpen && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 bg-card border border-border rounded-lg shadow-lg py-1 max-h-80 overflow-auto">
            <Link
              href="/"
              onClick={() => setProjectsMenuOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-foreground hover:bg-accent"
            >
              <Icon name="folder" className="w-3.5 h-3.5" />
              View all projects
            </Link>
            <div className="border-t border-border my-1" />
            {data.projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                onClick={() => setProjectsMenuOpen(false)}
                className={`flex flex-col px-3 py-2 text-[13px] hover:bg-accent ${project?.id === p.id ? "bg-accent" : ""}`}
              >
                <span className="font-medium text-foreground truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground truncate">{p.client}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {project && (
        <>
          <div className="shrink-0 text-[13px] font-bold px-2 pt-2 pb-1.5 truncate" title={project.name}>
            {project.name}
          </div>

          <nav className="shrink-0 flex flex-col gap-px">
            {(() => {
              const activeKey = sectionFromPath(pathname, project.id);
              const pend = data.requests.filter((r) => r.proj === project.id && r.status === "Pending").length;
              const apPend = data.approvals.filter((a) => a.proj === project.id && a.status === "Pending").length;
              const billPend = data.bills.filter((b) => b.proj === project.id && b.status === "Submitted").length;

              return NAV_ITEMS.filter((it) => allowed.includes(it.key)).map((it) => {
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
              });
            })()}
          </nav>
        </>
      )}

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

      <div className="shrink-0 relative mt-auto" ref={roleMenuRef}>
        {roleMenuOpen && (
          <div className="absolute left-2 right-2 bottom-full mb-2 z-20 bg-card border border-border rounded-lg shadow-lg py-1">
            <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Switch role
            </div>
            {ROLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setRole(opt.value);
                  setRoleMenuOpen(false);
                }}
                className="flex items-center justify-between gap-2 w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-accent"
              >
                <span className={role === opt.value ? "font-semibold" : ""}>{opt.label}</span>
                {role === opt.value && <Icon name="check" className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setRoleMenuOpen((v) => !v)}
          className="flex items-center gap-2.5 w-full text-left pt-3 pb-2 px-2 border-t border-border hover:bg-accent rounded-md outline-none focus-visible:bg-accent"
        >
          <div className="w-[30px] h-[30px] rounded-full bg-muted grid place-items-center text-[11.5px] font-semibold flex-none">
            {initials(user.n)}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] leading-tight truncate">{user.n}</div>
            <div className="text-[11.5px] text-muted-foreground">{user.t}</div>
          </div>
          <Icon name="chevronRight" className="w-3.5 h-3.5 ml-auto text-muted-foreground -rotate-90 flex-none" />
        </button>
      </div>
    </aside>
  );
}
