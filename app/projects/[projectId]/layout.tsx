"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import { ALLOWED_SECTIONS, sectionFromPath } from "@/lib/nav";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { data, role, setLastProjectId } = useApp();
  const projectId = params.projectId;
  const exists = data.projects.some((p) => p.id === projectId);

  useEffect(() => {
    if (exists) setLastProjectId(projectId);
  }, [exists, projectId, setLastProjectId]);

  // Redirect away from a section this role isn't allowed to view (e.g. after
  // switching roles while parked on a page the new role can't access).
  useEffect(() => {
    if (!exists) return;
    const section = sectionFromPath(pathname, projectId);
    if (!ALLOWED_SECTIONS[role].includes(section)) {
      router.replace(`/projects/${projectId}`);
    }
  }, [exists, pathname, projectId, role, router]);

  if (!exists) {
    return (
      <div className="text-muted-foreground text-[13.5px]">
        Project not found.{" "}
        <Link href="/" className="underline text-foreground">
          Back to all projects
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
