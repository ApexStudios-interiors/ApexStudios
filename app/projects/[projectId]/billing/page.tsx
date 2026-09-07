"use client";

import { useParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { isClientRole } from "@/lib/logic";
import { BillingAdmin } from "@/components/domain/BillingAdmin";
import { BillingClient } from "@/components/domain/BillingClient";

export default function BillingPage() {
  const params = useParams<{ projectId: string }>();
  const { data, role } = useApp();
  const project = data.projects.find((p) => p.id === params.projectId)!;

  return isClientRole(role) ? <BillingClient project={project} /> : <BillingAdmin project={project} />;
}
