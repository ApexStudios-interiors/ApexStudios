"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { transitionStockRequest } from "@/features/stock/actions";
import { DialogShell, Field, textareaClass } from "@/components/ui/DialogShell";

/**
 * build/07-stock-inventory-notifications.md §2.5: "Reject requires a
 * reason: the Reject button opens a small confirm dialog with a required
 * reason field. Do not send an empty reason and let the database refuse
 * it; that produces a generic error where a field-level message belongs."
 * `sr_reject_ck` (migration 0007) and `rpc_transition_stock_request`'s own
 * `REASON_REQUIRED` are the real enforcement — this schema is the field-level
 * message the build note asks for, checked before either of those ever run.
 */
const rejectSchema = z.object({
  note: z.string().trim().min(1, "Please give a reason."),
});

export function RejectStockRequestDialog({ requestId }: { requestId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(rejectSchema), defaultValues: { note: "" } });

  const reject = useAction(transitionStockRequest, {
    onSuccess: () => {
      closeDialog();
      toast("Request rejected");
      router.refresh();
    },
  });

  const onSubmit = handleSubmit((values) =>
    reject.execute({ requestId, toStatus: "rejected", note: values.note })
  );

  return (
    <DialogShell
      title="Reject Stock Request"
      okLabel={reject.isPending ? "Rejecting…" : "Reject"}
      okPending={reject.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit}>
        <Field label="Reason" htmlFor="rsr-note">
          <textarea
            id="rsr-note"
            className={textareaClass}
            placeholder="Why is this request being rejected?"
            autoFocus
            {...register("note")}
          />
        </Field>
        {errors.note && <p className="text-xs text-destructive mt-1">{errors.note.message}</p>}
        {reject.result.serverError && (
          <p className="text-[12.5px] text-destructive mt-2">{reject.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
