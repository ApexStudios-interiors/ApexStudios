"use client";

import { useLegacyModule } from "@/hooks/useLegacyModule";
import { MilestoneTable } from "@/components/domain/MilestoneTable";
import { Empty } from "@/components/ui/Empty";

/** Still AppContext — Build 09 converts this tab. Admin-only in the tab bar
 *  (layout.tsx), matching the prototype's own level of protection. */
export default function PackageBillingTab() {
  const { project, module: mod } = useLegacyModule();
  if (!mod) return <Empty>Not available yet for a package created outside the demo data.</Empty>;

  return <MilestoneTable project={project} module={mod} />;
}
