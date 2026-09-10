"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { OpenDialogButton } from "@/components/domain/OpenDialogButton";
import { Icon } from "@/components/ui/Icon";

/**
 * ui-guide.md §6.5's buttons, tab-scoped: Edit (Admin, every tab) · + Add Task
 * (Schedule tab, not Client) · + Post Update (Updates tab, not Client) ·
 * + Stock Request (not Client, every tab). Needs the active tab, which a
 * layout can only read on the client (`useSelectedLayoutSegment`) — the one
 * reason this strip is its own leaf instead of living in `layout.tsx` itself.
 */
export function PackageDetailActions({
  projectId,
  moduleId,
  isMoney,
  isClient,
}: {
  projectId: string;
  moduleId: string;
  isMoney: boolean;
  isClient: boolean;
}) {
  const tab = useSelectedLayoutSegment();

  return (
    <div className="ml-auto flex gap-2">
      {isMoney && (
        <OpenDialogButton dialog={{ kind: "editModule", projectId, moduleId }}>Edit</OpenDialogButton>
      )}
      {tab === "schedule" && !isClient && (
        <OpenDialogButton dialog={{ kind: "addTask", projectId, moduleId }}>
          <Icon name="plus" className="w-[15px] h-[15px]" />
          Add Task
        </OpenDialogButton>
      )}
      {tab === "updates" && !isClient && (
        <OpenDialogButton dialog={{ kind: "postUpdate", projectId, moduleId }}>
          <Icon name="plus" className="w-[15px] h-[15px]" />
          Post Update
        </OpenDialogButton>
      )}
      {!isClient && (
        <OpenDialogButton dialog={{ kind: "newRequest", projectId, moduleId }} variant="primary">
          <Icon name="plus" className="w-[15px] h-[15px]" />
          Stock Request
        </OpenDialogButton>
      )}
    </div>
  );
}
