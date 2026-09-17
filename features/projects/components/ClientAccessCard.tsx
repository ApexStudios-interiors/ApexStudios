import type { ProjectClientAccess } from "@/features/projects/queries";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { initials } from "@/lib/logic";

/**
 * D51: the project's client logins, and the two ways to add one — create a new
 * login for this project, or give an existing client login access to it too.
 *
 * There was no project team or membership surface anywhere in the app before
 * this (addProjectMember had no caller), so it lives on the project dashboard
 * and the page renders it for owner/admin only. Site supervisor membership is
 * not managed here; this card is about client sign-ins.
 */
export function ClientAccessCard({
  projectId,
  projectName,
  access,
}: {
  projectId: string;
  projectName: string;
  access: ProjectClientAccess;
}) {
  return (
    <Card className="mt-5">
      <CardHeader>
        <h3>Client access</h3>
        <div className="ml-auto flex gap-2 items-center">
          {access.others.length > 0 && (
            <OpenDialogButton
              size="sm"
              dialog={{ kind: "grantClientAccess", projectId, projectName, clients: access.others }}
            >
              Add existing client
            </OpenDialogButton>
          )}
          <OpenDialogButton
            size="sm"
            variant="primary"
            dialog={{ kind: "createClientLogin", projectId, projectName }}
          >
            <Icon name="plus" className="w-[15px] h-[15px]" />
            Create client login
          </OpenDialogButton>
        </div>
      </CardHeader>
      {access.members.length === 0 ? (
        <p className="px-5 py-4 text-[13.5px] text-muted-foreground">
          No client can sign in to see this project yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {access.members.map((m) => (
            <li key={m.id} className="px-5 py-3 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">
                {initials(m.fullName)}
              </div>
              <span className="font-medium text-[13.5px]">{m.fullName}</span>
              {m.email && <span className="ml-auto text-[13px] text-muted-foreground">{m.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
