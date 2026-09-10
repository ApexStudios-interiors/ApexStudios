"use client";

import { useApp } from "@/context/AppContext";
import { useProject } from "@/hooks/useProject";
import { isMoney } from "@/lib/logic";
import { ModuleTable } from "@/components/domain/ModuleTable";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export default function PackagesPage() {
  const { role, openDialog } = useApp();
  const project = useProject();

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Packages</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{project.modules.length} packages</p>
        </div>
        <div className="ml-auto flex gap-2">
          {isMoney(role) && (
            <Button
              variant="primary"
              onClick={() => openDialog({ kind: "addModule", projectId: project.id })}
            >
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Add Package
            </Button>
          )}
        </div>
      </div>
      <Card>
        <ModuleTable project={project} />
      </Card>
    </div>
  );
}
