"use client";

import { useApp } from "@/context/AppContext";
import { useLegacyModule } from "@/hooks/useLegacyModule";
import { UpdateList } from "@/components/domain/UpdateList";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";

/** Still AppContext — Build 08 converts this tab. */
export default function PackageUpdatesTab() {
  const { data } = useApp();
  const { project, module: mod } = useLegacyModule();
  if (!mod) return <Empty>Not available yet for a package created outside the demo data.</Empty>;

  const updates = data.updates.filter((u) => u.proj === project.id && u.mod === mod.id);

  return (
    <Card>
      {updates.length ? <UpdateList project={project} updates={updates} /> : <Empty>No updates yet.</Empty>}
    </Card>
  );
}
