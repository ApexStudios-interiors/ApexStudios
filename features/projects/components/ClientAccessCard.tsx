import type { ProjectClientAccess } from "@/features/projects/queries";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { initials } from "@/lib/format";
import { RemoveProjectMemberButton } from "./RemoveProjectMemberButton";

/**
 * D51: the project's client logins, each with Remove (take them off THIS
 * project only), and Add existing client to give a client login that already
 * exists access to this project too. A NEW client login is
 * created from Users → Add User with the Client role (the card's own Create
 * client login button was removed 2026-11-23, once Add User could do it).
 *
 * There was no project team or membership surface anywhere in the app before
 * this (addProjectMember had no caller), so it lives on the project dashboard
 * and the page renders it for admins only. Site Supervisor membership is the
 * Site team card (SiteTeamCard, APX-12); this card is about client sign-ins.
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
    <Card id="client-access" className="mt-5 scroll-mt-4">
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
              <span className="ml-auto flex items-center gap-3">
                {m.email && <span className="text-[13px] text-muted-foreground">{m.email}</span>}
                <RemoveProjectMemberButton
                  role="client"
                  projectId={projectId}
                  projectName={projectName}
                  profileId={m.id}
                  fullName={m.fullName}
                  projectCount={m.projectCount}
                  onlyMemberOnProject={access.members.length === 1}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
