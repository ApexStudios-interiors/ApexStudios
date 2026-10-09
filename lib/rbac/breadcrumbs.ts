import type { Section } from "./nav";
import { projectPath } from "@/lib/routing/paths";

/**
 * One breadcrumb. `href` is where the crumb points if it points anywhere at
 * all; `isLink` is whether it should actually be rendered as a link.
 */
export type Crumb = { label: string; href: string | null; isLink: boolean };

/**
 * The link rule for the project breadcrumb, stated once instead of
 * special-cased per section: every ancestor crumb links to its own page, the
 * last crumb (the page you are on) never links, and a crumb whose href is
 * the current pathname never links to itself. That covers every section
 * `sectionFromPath` can return — Packages, Approvals, Billing/Bills and the
 * rest — without naming any of them here.
 */
export function projectCrumbs({
  pathname,
  projectId,
  projectName,
  section,
  sectionLabel,
  packageId = null,
  packageLabel = null,
  projectCode = null,
  packageSegment = null,
}: {
  pathname: string;
  projectId: string;
  /** Empty when the project is not in the role-scoped nav list. */
  projectName: string;
  section: Section;
  sectionLabel: string;
  packageId?: string | null;
  packageLabel?: string | null;
  /** The project's code. When given, every crumb links to the canonical
   *  `/projects/bhel-nch/…` instead of the id form, which middleware would
   *  answer with a redirect. Optional so the id form stays the fallback when
   *  the project is not in the role-scoped nav list and no code is to hand. */
  projectCode?: string | null;
  /** The package's canonical URL segment, from `packagePath`. */
  packageSegment?: string | null;
}): Crumb[] {
  const projectHref = projectCode ? projectPath({ code: projectCode }) : `/projects/${projectId}`;
  const entries: { label: string; href: string | null }[] = [
    { label: projectName, href: projectName ? projectHref : null },
    {
      label: sectionLabel,
      // The dashboard IS the project page, so it has no page of its own
      // beyond the one the project crumb already points at.
      href: section === "dashboard" ? projectHref : `${projectHref}/${section}`,
    },
  ];
  if (packageLabel) {
    entries.push({
      label: packageLabel,
      href: packageSegment
        ? `${projectHref}/packages/${packageSegment}`
        : packageId
          ? `${projectHref}/packages/${packageId}`
          : null,
    });
  }

  const last = entries.length - 1;
  return entries.map((e, i) => ({
    ...e,
    isLink: i !== last && e.href !== null && e.href !== pathname,
  }));
}
