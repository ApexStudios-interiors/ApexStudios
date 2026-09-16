"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { certifyBill } from "@/features/billing/actions";
import { DialogShell } from "@/components/ui/DialogShell";

/**
 * build/09-billing.md §4.5. Certification is the client's own sign-off on a
 * real invoice — "Only a Client may certify a bill" (AGENTS.md billing
 * rules) — a commercially meaningful, irreversible click, so it gets a
 * confirmation step the same way `DecideApprovalDialog`'s own "approved"
 * branch does for an approval (Build 08's own precedent). `rpc_transition_bill`
 * itself is the real enforcement; this is the deliberate pause before it.
 */
export function CertifyBillDialog({ billId, refNo }: { billId: string; refNo: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setPending(true);
    setError(null);
    const result = await certifyBill({ billId, toStatus: "certified" });
    setPending(false);
    if (!result?.data) {
      setError(result?.serverError ?? "Could not certify this bill");
      return;
    }
    closeDialog();
    router.refresh();
    toast(`${refNo} approved`);
  }

  return (
    <DialogShell
      title="Approve"
      description={refNo}
      okLabel={pending ? "Approving…" : "Approve"}
      okDisabled={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <p className="text-[13.5px] text-muted-foreground">
        This is your certification of this bill — it cannot be undone. Are you sure?
      </p>
      {error && <p className="text-[12.5px] text-destructive mt-2">{error}</p>}
    </DialogShell>
  );
}
