"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { rejectBill } from "@/features/billing/actions";
import { DialogShell, Field, textareaClass } from "@/components/ui/DialogShell";

/**
 * build/09-billing.md §4.5: "Reject with a mandatory reason, returning the
 * bill to Draft with revision += 1." Same shape as `RejectStockRequestDialog`
 * (Build 07) — `rpc_transition_bill`'s own `REASON_REQUIRED` is the real
 * enforcement; this is the field-level message ahead of that round trip.
 */
const rejectSchema = z.object({
  reason: z.string().trim().min(1, "Please give a reason."),
});

export function RejectBillDialog({ billId, refNo }: { billId: string; refNo: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(rejectSchema), defaultValues: { reason: "" } });

  const reject = useAction(rejectBill, {
    onSuccess: () => {
      closeDialog();
      toast(`${refNo} returned to draft`);
      router.refresh();
    },
  });

  const onSubmit = handleSubmit((values) => reject.execute({ billId, reason: values.reason }));

  return (
    <DialogShell
      title="Reject Bill"
      description={refNo}
      okLabel={reject.isPending ? "Rejecting…" : "Reject"}
      okPending={reject.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit}>
        <Field label="Reason" htmlFor="rb-reason">
          <textarea
            id="rb-reason"
            className={textareaClass}
            placeholder="Why is this bill being rejected?"
            autoFocus
            {...register("reason")}
          />
        </Field>
        {errors.reason && <p className="text-xs text-destructive mt-1">{errors.reason.message}</p>}
        {reject.result.serverError && (
          <p className="text-[12.5px] text-destructive mt-2">{reject.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
