"use client";

import { usePathname, useParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { sectionFromPath } from "@/lib/rbac/nav";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationsMenu } from "@/components/layout/NotificationsMenu";
import { SearchBar } from "@/components/layout/SearchBar";
import type { NotificationDTO } from "@/features/notifications/queries";

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

export function Header({ notifications }: { notifications: NotificationDTO[] }) {
  const { data, role } = useApp();
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
    const project = data.projects.find((p) => p.id === params.projectId);
    const section = sectionFromPath(pathname, params.projectId);
    const sectionLabel =
      section === "billing" ? (role === "client" ? "Bills" : "Billing") : SECTION_LABELS[section];
    const mod = params.moduleId ? project?.modules.find((m) => m.id === params.moduleId) : null;
    // `mod` can only be non-null when `project` is defined; state that for the compiler.
    const modNo = project && mod ? String(project.modules.indexOf(mod) + 1).padStart(2, "0") : "";
    crumb = (
      <>
        {project?.name} <span>/</span> <b className="text-foreground font-semibold">{sectionLabel}</b>
        {mod && (
          <>
            {" "}
            <span>/</span>{" "}
            <b className="text-foreground font-semibold">
              {modNo} {mod.name}
            </b>
          </>
        )}
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
