"use client";

import { useLegacyModule } from "@/hooks/useLegacyModule";
import { Gantt } from "@/components/domain/Gantt";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";

/** Still AppContext — Build 06 converts this tab. */
export default function PackageScheduleTab() {
  const { project, module: mod } = useLegacyModule();
  if (!mod) return <Empty>Not available yet for a package created outside the demo data.</Empty>;

  return (
    <Card>
      <Gantt project={project} module={mod} />
    </Card>
  );
}
