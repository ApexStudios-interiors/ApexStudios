"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { decideApproval } from "@/features/approvals/actions";
import { DialogShell, Field, textareaClass } from "@/components/ui/DialogShell";

/**
 * build/08-approvals.md §2.5 step 3: "Reject opens a confirm dialog with a
 * required reason field. Approve gets a confirmation step too: it is a
 * commercially meaningful, irreversible click on a phone." One dialog,
 * parameterized by `decision` — the reason field only renders (and is only
 * required) for a rejection; `rpc_decide_approval`'s own `REASON_REQUIRED`
 * is the real enforcement (same pattern as `RejectStockRequestDialog`), this
 * is the field-level message ahead of that round trip.
 */
export function DecideApprovalDialog({
  approvalId,
  decision,
  item,
}: {
  approvalId: string;
  decision: "approved" | "rejected";
  item: string;
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit() {
    if (decision === "rejected" && !reason.trim()) {
      setFieldError("Please give a reason for rejecting");
      return;
    }
    setFieldError(null);
    setPending(true);
    setServerError(null);
    const result = await decideApproval({ approvalId, decision, reason: reason || undefined });
    setPending(false);
    if (!result?.data) {
      setServerError(result?.serverError ?? "Could not record this decision");
      return;
    }
    closeDialog();
    router.refresh();
    toast(decision === "approved" ? "Approval approved" : "Approval rejected");
  }

  return (
    <DialogShell
      title={decision === "approved" ? "Approve" : "Reject Approval"}
      description={item}
      okLabel={pending ? "Saving…" : decision === "approved" ? "Approve" : "Reject"}
      okPending={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      {decision === "approved" ? (
        <p className="text-[13.5px] text-muted-foreground">
          This is your sign-off on this sample or drawing — it cannot be undone. Are you sure?
        </p>
      ) : (
        <>
          <Field label="Reason" htmlFor="da-reason">
            <textarea
              id="da-reason"
              className={textareaClass}
              placeholder="Why is this being rejected?"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {fieldError && <p className="text-xs text-destructive mt-1">{fieldError}</p>}
        </>
      )}
      {serverError && <p className="text-[12.5px] text-destructive mt-2">{serverError}</p>}
    </DialogShell>
  );
}
