import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { packagePath, projectPath, withAmbiguityFlags } from "@/lib/routing/paths";
import { setupChecklist, type SetupFacts, type SetupItem } from "@/features/projects/service";

const linkClass = "text-[13px] font-medium underline underline-offset-2 hover:text-foreground";

/**
 * APX-70: what is still missing before this project can run, in the order it
 * has to be done — packages with budgets, phases, tasks, a site supervisor,
 * client access, status Active. Admin only (the page renders it for admins
 * alone, and the facts behind it read admin-only tables). Each open item
 * links to where it is fixed; the card disappears once every item is done
 * (showSetupChecklist, decided by the page).
 */
export function SetupChecklistCard({
  projectId,
  projectName,
  facts,
}: {
  projectId: string;
  projectName: string;
  facts: SetupFacts & { code: string };
}) {
  const items = setupChecklist(facts);
  const done = items.filter((i) => i.done).length;
  const packages = withAmbiguityFlags(facts.packages);

  function action(item: SetupItem) {
    const t = item.target;
    switch (t.kind) {
      case "addPackage":
        return (
          <OpenDialogButton size="sm" dialog={{ kind: "addModule", projectId }}>
            Add Package
          </OpenDialogButton>
        );
      case "package": {
        const pkg = packages.find((p) => p.id === t.packageId);
        const rest = `/${t.tab}`;
        const href =
          pkg && facts.code
            ? packagePath({ code: facts.code }, pkg, rest)
            : `/projects/${projectId}/packages/${t.packageId}${rest}`;
        return (
          <Link href={href} className={linkClass}>
            {t.tab === "budget" ? "Open Budget" : "Open Schedule"}
          </Link>
        );
      }
      case "siteTeam":
        return (
          <a href="#site-team" className={linkClass}>
            Site team
          </a>
        );
      case "clientAccess":
        return (
          <a href="#client-access" className={linkClass}>
            Client access
          </a>
        );
      case "status":
        return (
          <OpenDialogButton
            size="sm"
            dialog={{ kind: "projectStatus", projectId, projectName, status: facts.status }}
          >
            Change status
          </OpenDialogButton>
        );
    }
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <h3>Set up this project</h3>
        <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">
          {done} of {items.length} done
        </span>
      </CardHeader>
      <ol className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.key} className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {item.done ? (
              <CheckCircle2 aria-hidden className="size-4 shrink-0" />
            ) : (
              <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span
              className={`text-[13.5px] ${item.done ? "text-muted-foreground line-through" : "font-medium"}`}
            >
              {item.label}
              <span className="sr-only">{item.done ? " — done" : " — to do"}</span>
            </span>
            {!item.done && item.detail && (
              <span className="text-[13px] text-muted-foreground">{item.detail}</span>
            )}
            {!item.done && <span className="ml-auto">{action(item)}</span>}
          </li>
        ))}
      </ol>
      {facts.code && (
        <p className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
          This list goes away once everything is done. Packages are also on the{" "}
          <Link
            href={projectPath({ code: facts.code }, "/packages")}
            className="underline underline-offset-2"
          >
            Packages
          </Link>{" "}
          page.
        </p>
      )}
    </Card>
  );
}
