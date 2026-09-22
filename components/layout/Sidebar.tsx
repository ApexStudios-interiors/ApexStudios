"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Fragment, useRef, useState, useTransition } from "react";
import { useAction } from "next-safe-action/hooks";
import { BookOpenIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useSession } from "@/components/auth/SessionProvider";
import { signOut } from "@/features/auth/actions";
import { startPreview } from "@/features/auth/impersonation-actions";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { NavProject } from "@/components/layout/nav-project";
import { initials } from "@/lib/logic";
import { ALLOWED_SECTIONS, type Section, sectionFromPath } from "@/lib/rbac/nav";
import { ROLE_LABEL } from "@/lib/rbac/roles";
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

/** D20: which roles owner/admin may preview a project as. */
const PREVIEW_OPTIONS: { value: "client" | "site"; label: string }[] = [
  { value: "site", label: "Site Supervisor" },
  { value: "client", label: "Client" },
];

export function Sidebar({
  /** The real, role-scoped project list, read from the database by the app
   *  shell — including each project's packages and pending counts. Previously
   *  this menu mapped over AppContext's `lib/data.ts` fixture, so a project
   *  created through the app never appeared here, no real project ever listed
   *  a package, and every badge read 0. */
  projects,
}: {
  projects: NavProject[];
}) {
  // `role` here is the EFFECTIVE role (impersonated role while previewing) —
  // exactly what nav filtering should use. `session` is the REAL identity:
  // real name, real role, whether a preview is active. Never mix the two up.
  const { role } = useApp();
  const session = useSession();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string; moduleId?: string }>();
  const [modsOpen, setModsOpen] = useState(true);
  const [projectsMenuOpen, setProjectsMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const projectsMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [signOutPending, startSignOut] = useTransition();
  const preview = useAction(startPreview, { onSuccess: () => setUserMenuOpen(false) });

  useClickOutside(projectsMenuRef, () => setProjectsMenuOpen(false), projectsMenuOpen);
  useClickOutside(userMenuRef, () => setUserMenuOpen(false), userMenuOpen);

  const isHome = pathname === "/";
  const project = params?.projectId ? (projects.find((p) => p.id === params.projectId) ?? null) : null;
  const allowed = ALLOWED_SECTIONS[role];

  const canPreview = session.role === "owner" || session.role === "admin";
  /** The Studio group — Users and Failed Jobs — is owner/admin only. Docs sits
   *  directly below it and is help content every role may read, so it renders
   *  outside that gate; when the group is hidden, Docs takes over the group
   *  label's own top spacing so the link lands in the same place for everyone. */
  const showStudio = role === "admin" || role === "owner";

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
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                onClick={() => setProjectsMenuOpen(false)}
                className={`flex flex-col px-3 py-2 text-[13px] hover:bg-accent ${params?.projectId === p.id ? "bg-accent" : ""}`}
              >
                <span className="font-medium text-foreground truncate">{p.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {role !== "client" && (
        <Link
          href="/inventory"
          className={`shrink-0 flex items-center gap-2.5 w-full text-left border-0 rounded-md px-2 py-[7px] mb-2.5 cursor-pointer text-[13.5px] ${
            pathname === "/inventory"
              ? "bg-accent font-semibold text-foreground"
              : "font-medium text-foreground hover:bg-accent"
          }`}
        >
          <Icon
            name="archive"
            className={`w-4 h-4 flex-none ${pathname === "/inventory" ? "text-foreground" : "text-muted-foreground"}`}
          />
          Inventory
          <span className="ml-auto text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            All
          </span>
        </Link>
      )}

      {project && (
        <>
          <div className="shrink-0 text-[13px] font-bold px-2 pt-2 pb-1.5 truncate" title={project.name}>
            {project.name}
          </div>

          <nav className="shrink-0 flex flex-col gap-px">
            {(() => {
              const activeKey = sectionFromPath(pathname, project.id);
              // Same three rules as the prototype, with real numbers behind
              // them: stock pending for everyone but a client, approvals
              // pending and bills submitted for a client only.
              const pend = project.pendingRequests;
              const apPend = project.pendingApprovals;
              const billPend = project.submittedBills;

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
                        on
                          ? "bg-accent font-semibold text-foreground"
                          : "font-medium text-foreground hover:bg-accent"
                      }`}
                    >
                      <Icon
                        name={it.icon}
                        className={`w-4 h-4 flex-none ${on ? "text-foreground" : "text-muted-foreground"}`}
                      />
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
                          <Icon
                            name="chevronRight"
                            className={`w-3.5 h-3.5 transition-transform ${modsOpen ? "rotate-90" : ""}`}
                          />
                        </span>
                      ) : null}
                    </Link>
                    {it.key === "packages" &&
                      modsOpen &&
                      project.packages.map((m, i) => (
                        <Link
                          key={m.id}
                          href={`/projects/${project.id}/packages/${m.id}`}
                          className={`flex items-center gap-2.5 w-full text-left border-0 rounded-md pl-[34px] pr-2 py-[7px] cursor-pointer text-[13.5px] ${
                            params?.moduleId === m.id
                              ? "text-foreground font-medium bg-accent"
                              : "text-muted-foreground font-normal hover:bg-accent"
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

      <div className="shrink-0">
        {showStudio && (
          <>
            <div className="text-[11px] font-semibold text-muted-foreground px-2 pt-3.5 pb-1.5 uppercase tracking-wider">
              Studio
            </div>
            <Link
              href="/users"
              className={`flex items-center gap-2.5 w-full text-left border-0 rounded-md px-2 py-[7px] cursor-pointer text-[13.5px] ${
                pathname === "/users"
                  ? "bg-accent font-semibold text-foreground"
                  : "font-medium text-foreground hover:bg-accent"
              }`}
            >
              <Icon
                name="users"
                className={`w-4 h-4 flex-none ${pathname === "/users" ? "text-foreground" : "text-muted-foreground"}`}
              />
              Users
            </Link>
            <Link
              href="/ops/jobs"
              className={`flex items-center gap-2.5 w-full text-left border-0 rounded-md px-2 py-[7px] cursor-pointer text-[13.5px] ${
                pathname === "/ops/jobs"
                  ? "bg-accent font-semibold text-foreground"
                  : "font-medium text-foreground hover:bg-accent"
              }`}
            >
              <Icon
                name="box"
                className={`w-4 h-4 flex-none ${pathname === "/ops/jobs" ? "text-foreground" : "text-muted-foreground"}`}
              />
              Failed Jobs
            </Link>
          </>
        )}
        <Link
          href="/docs"
          className={`flex items-center gap-2.5 w-full text-left border-0 rounded-md px-2 py-[7px] cursor-pointer text-[13.5px] ${
            showStudio ? "" : "mt-3.5"
          } ${
            pathname === "/docs"
              ? "bg-accent font-semibold text-foreground"
              : "font-medium text-foreground hover:bg-accent"
          }`}
        >
          <BookOpenIcon
            className={`w-4 h-4 flex-none ${pathname === "/docs" ? "text-foreground" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
          Docs
        </Link>
      </div>

      <div className="shrink-0 relative mt-auto" ref={userMenuRef}>
        {userMenuOpen && (
          <div className="absolute left-2 right-2 bottom-full mb-2 z-20 bg-card border border-border rounded-lg shadow-lg py-1">
            {canPreview && project && !session.impersonating && (
              <>
                <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Preview as
                </div>
                {PREVIEW_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    disabled={preview.isPending}
                    onClick={() => preview.execute({ role: opt.value, projectId: project.id })}
                    className="flex items-center justify-between gap-2 w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {opt.label}
                  </button>
                ))}
                <div className="border-t border-border my-1" />
              </>
            )}
            <button
              disabled={signOutPending}
              onClick={() => startSignOut(() => signOut())}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
            >
              {signOutPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex items-center gap-2.5 w-full text-left pt-3 pb-2 px-2 border-t border-border hover:bg-accent rounded-md outline-none focus-visible:bg-accent"
        >
          <div className="w-[30px] h-[30px] rounded-full bg-muted grid place-items-center text-[11.5px] font-semibold flex-none">
            {initials(session.fullName)}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] leading-tight truncate">{session.fullName}</div>
            <div className="text-[11.5px] text-muted-foreground">{ROLE_LABEL[session.role]}</div>
          </div>
          <Icon
            name="chevronRight"
            className="w-3.5 h-3.5 ml-auto text-muted-foreground -rotate-90 flex-none"
          />
        </button>
      </div>
    </aside>
  );
}
