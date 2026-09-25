import type { Section } from "./nav";

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
}: {
  pathname: string;
  projectId: string;
  /** Empty when the project is not in the role-scoped nav list. */
  projectName: string;
  section: Section;
  sectionLabel: string;
  packageId?: string | null;
  packageLabel?: string | null;
}): Crumb[] {
  const projectHref = `/projects/${projectId}`;
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
      href: packageId ? `${projectHref}/packages/${packageId}` : null,
    });
  }

  const last = entries.length - 1;
  return entries.map((e, i) => ({
    ...e,
    isLink: i !== last && e.href !== null && e.href !== pathname,
  }));
}
