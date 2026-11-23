"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Icon } from "@/components/ui/Icon";

/**
 * ui-guide.md §6.5's buttons, tab-scoped: Edit (Admin, every tab) · + Add Task
 * (Schedule tab, not Client) · + Post Update (Updates tab, not Client) ·
 * + Stock Request (not Client, every tab). Needs the active tab, which a
 * layout can only read on the client (`useSelectedLayoutSegment`) — the one
 * reason this strip is its own leaf instead of living in `layout.tsx` itself.
 *
 * APX-41: `refusals` (from projectWriteRefusal, decided by the layout) disable
 * the buttons a completed or archived project no longer allows; the sentence
 * is the button's title, and the project's banner says it in plain sight.
 */
export function PackageDetailActions({
  projectId,
  moduleId,
  isMoney,
  isClient,
  refusals,
}: {
  projectId: string;
  moduleId: string;
  isMoney: boolean;
  isClient: boolean;
  refusals: { edit: string | null; stockRequest: string | null; dailyUpdate: string | null };
}) {
  const tab = useSelectedLayoutSegment();
  const off = (reason: string | null) => ({ disabled: !!reason, title: reason ?? undefined });

  return (
    <div className="ml-auto flex gap-2 flex-wrap">
      {isMoney && (
        <OpenDialogButton dialog={{ kind: "editModule", projectId, moduleId }} {...off(refusals.edit)}>
          Edit
        </OpenDialogButton>
      )}
      {tab === "schedule" && !isClient && (
        <OpenDialogButton dialog={{ kind: "addTask", projectId, moduleId }} {...off(refusals.edit)}>
          <Icon name="plus" className="w-[15px] h-[15px]" />
          Add Task
        </OpenDialogButton>
      )}
      {tab === "updates" && !isClient && (
        <OpenDialogButton dialog={{ kind: "postUpdate", projectId, moduleId }} {...off(refusals.dailyUpdate)}>
          <Icon name="plus" className="w-[15px] h-[15px]" />
          Post Update
        </OpenDialogButton>
      )}
      {!isClient && (
        <OpenDialogButton
          dialog={{ kind: "newRequest", projectId, moduleId }}
          variant="primary"
          {...off(refusals.stockRequest)}
        >
          <Icon name="plus" className="w-[15px] h-[15px]" />
          Stock Request
        </OpenDialogButton>
      )}
    </div>
  );
}
