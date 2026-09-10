"use client";

import { useApp } from "@/context/AppContext";
import { useLegacyModule } from "@/hooks/useLegacyModule";
import { ReqTable } from "@/components/domain/ReqTable";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";

/** Still AppContext — Build 07 converts this tab. Hidden for Client in the
 *  tab bar (layout.tsx); this route itself is unchanged from the prototype's
 *  own level of protection, which was also client-side only. */
export default function PackageStockTab() {
  const { data } = useApp();
  const { project, module: mod } = useLegacyModule();
  if (!mod) return <Empty>Not available yet for a package created outside the demo data.</Empty>;

  const reqs = data.requests.filter((r) => r.proj === project.id && r.mod === mod.id);

  return (
    <Card>
      <ReqTable project={project} reqs={reqs} moduleContext />
    </Card>
  );
}
