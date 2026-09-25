"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname, useParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { sectionFromPath } from "@/lib/rbac/nav";
import { projectCrumbs } from "@/lib/rbac/breadcrumbs";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationsMenu } from "@/components/layout/NotificationsMenu";
import { SearchBar } from "@/components/layout/SearchBar";
import type { NotificationDTO } from "@/features/notifications/queries";
import type { NavProject } from "@/components/layout/nav-project";

const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  packages: "Packages",
  schedule: "Schedule",
  updates: "Daily Updates",
  inventory: "Inventory",
  stock: "Stock Requests",
  approvals: "Approvals",
  billing: "Billing",
};

export function Header({
  notifications,
  /** The same role-scoped list the Sidebar renders, passed down by the app
   *  shell rather than re-queried here. The breadcrumb used to name the
   *  project and package off AppContext's `lib/data.ts` fixture, so a real
   *  project showed no name and a real package no crumb at all. */
  projects,
}: {
  notifications: NotificationDTO[];
  projects: NavProject[];
}) {
  const { role } = useApp();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string; moduleId?: string }>();

  let crumb: React.ReactNode = null;

  if (pathname === "/") {
    crumb = <b className="text-foreground font-semibold">All Projects</b>;
  } else if (pathname === "/users") {
    crumb = <b className="text-foreground font-semibold">Users</b>;
  } else if (pathname === "/inventory") {
    crumb = <b className="text-foreground font-semibold">Inventory</b>;
  } else if (params?.projectId) {
    const project = projects.find((p) => p.id === params.projectId);
    const section = sectionFromPath(pathname, params.projectId);
    const sectionLabel =
      section === "billing" ? (role === "client" ? "Bills" : "Billing") : (SECTION_LABELS[section] ?? "");
    const mod = params.moduleId ? project?.packages.find((m) => m.id === params.moduleId) : null;
    // `mod` can only be non-null when `project` is defined; state that for the compiler.
    const modNo = project && mod ? String(project.packages.indexOf(mod) + 1).padStart(2, "0") : "";
    const crumbs = projectCrumbs({
      pathname,
      projectId: params.projectId,
      projectName: project?.name ?? "",
      section,
      sectionLabel,
      packageId: mod?.id ?? null,
      packageLabel: mod ? `${modNo} ${mod.name}` : null,
    });
    crumb = (
      <>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span>/</span>}
            {c.isLink && c.href ? (
              <Link
                href={c.href}
                className={`rounded-sm hover:text-foreground hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  i > 0 ? "font-semibold" : ""
                }`}
              >
                {c.label}
              </Link>
            ) : i > 0 ? (
              <b className="text-foreground font-semibold">{c.label}</b>
            ) : (
              <span>{c.label}</span>
            )}
          </Fragment>
        ))}
      </>
    );
  }

  return (
    <div className="h-16 flex items-center gap-3 px-7 border-b border-border sticky top-0 bg-background z-[5]">
      <div className="flex items-center gap-2 text-[13.5px] text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
        {crumb}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <SearchBar />
        <NotificationsMenu items={notifications} />
        <ThemeToggle />
      </div>
    </div>
  );
}
