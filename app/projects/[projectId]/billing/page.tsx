"use client";

import { useApp } from "@/context/AppContext";
import { useProject } from "@/hooks/useProject";
import { isClientRole } from "@/lib/logic";
import { BillingAdmin } from "@/components/domain/BillingAdmin";
import { BillingClient } from "@/components/domain/BillingClient";

export default function BillingPage() {
  const { role } = useApp();
  const project = useProject();

  return isClientRole(role) ? <BillingClient project={project} /> : <BillingAdmin project={project} />;
}
