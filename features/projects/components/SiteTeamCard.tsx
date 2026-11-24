import type { ProjectSiteTeam } from "@/features/projects/queries";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { initials } from "@/lib/format";
import { RemoveProjectMemberButton } from "./RemoveProjectMemberButton";

/**
 * APX-12: the Site Supervisors who can see this project, each with Remove
 * (THIS project only), and Add site supervisor to put an existing one on it.
 * A Site Supervisor sees only the projects they are a member of, so until
 * this card existed a newly added supervisor saw an empty app and fixing it
 * needed SQL. A NEW supervisor login is created on the Users page (Add User,
 * Site Supervisor). Admins see every project and are never listed here.
 *
 * Same shape as ClientAccessCard on purpose — one rule (memberRemovalRefusal)
 * and one pair of actions behind both.
 */
export function SiteTeamCard({
  projectId,
  projectName,
  team,
}: {
  projectId: string;
  projectName: string;
  team: ProjectSiteTeam;
}) {
  return (
    <Card id="site-team" className="mt-5 scroll-mt-4">
      <CardHeader>
        <h3>Site team</h3>
        <div className="ml-auto flex gap-2 items-center">
          {team.others.length > 0 ? (
            <OpenDialogButton
              size="sm"
              dialog={{ kind: "grantSiteAccess", projectId, projectName, supervisors: team.others }}
            >
              Add site supervisor
            </OpenDialogButton>
          ) : (
            team.members.length === 0 && (
              <span className="text-[12.5px] text-muted-foreground">
                No Site Supervisor logins yet — add one on the Users page.
              </span>
            )
          )}
        </div>
      </CardHeader>
      {team.members.length === 0 ? (
        <p className="px-5 py-4 text-[13.5px] text-muted-foreground">
          No Site Supervisor can see this project yet, so nobody on site can post updates or raise stock
          requests for it.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {team.members.map((m) => (
            <li key={m.id} className="px-5 py-3 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-muted grid place-items-center text-xs font-semibold">
                {initials(m.fullName)}
              </div>
              <span className="font-medium text-[13.5px]">{m.fullName}</span>
              <span className="ml-auto flex items-center gap-3">
                {m.email && (
                  <span className="hidden sm:inline text-[13px] text-muted-foreground">{m.email}</span>
                )}
                <RemoveProjectMemberButton
                  role="site"
                  projectId={projectId}
                  projectName={projectName}
                  profileId={m.id}
                  fullName={m.fullName}
                  projectCount={m.projectCount}
                  onlyMemberOnProject={team.members.length === 1}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
