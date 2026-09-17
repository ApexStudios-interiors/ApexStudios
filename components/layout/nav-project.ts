import type { PackageNavItem } from "@/features/packages/queries";

/**
 * One project as the app shell's chrome needs it: the Sidebar's project menu
 * and project nav, and the Header's breadcrumb. Assembled by
 * `app/(app)/layout.tsx` from the role-scoped portfolio plus the three small
 * per-project reads the badges need, and passed down as props — the Sidebar
 * and Header are client components and must not query anything themselves.
 *
 * Every project the viewer may see is here, not just the one that is open:
 * the app shell is a layout, and Next.js does not re-render a layout on
 * navigation, so anything scoped to the open project would freeze at whatever
 * was open when the tab loaded.
 */
export type NavProject = {
  id: string;
  name: string;
  /** In `seq_no` order — the sub-list under the Sidebar's Packages item, and
   *  what the Header's `/packages/[moduleId]` crumb resolves against. */
  packages: PackageNavItem[];
  /** Stock requests awaiting a decision. Badged for every role but client,
   *  which has no Stock route at all. */
  pendingRequests: number;
  /** Approvals awaiting a decision. Badged for a client only — deciding one
   *  is a client's own job (AGENTS.md, billing rules). */
  pendingApprovals: number;
  /** Bills awaiting certification. Badged for a client only, same reason. */
  submittedBills: number;
};
