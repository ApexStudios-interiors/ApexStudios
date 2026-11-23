"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { withdrawApproval } from "@/features/approvals/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * APX-42: the person who requested an approval withdraws it while the client
 * has not yet decided — a wrong sample or drawing no longer has to wait for
 * the client to reject it. rpc_withdraw_approval (requester only, pending
 * only) removes it from the client's list and bell; it is kept in the audit
 * log. The row shows this only when `canWithdraw` is true.
 */
export function WithdrawApprovalButton({
  approvalId,
  refNo,
  item,
}: {
  approvalId: string;
  refNo: string;
  item: string;
}) {
  const router = useRouter();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);

  const withdraw = useAction(withdrawApproval, {
    onSuccess: () => {
      setOpen(false);
      toast(`${refNo} withdrawn`);
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          withdraw.reset();
          setOpen(true);
        }}
      >
        Withdraw
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!withdraw.isPending) setOpen(next);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Withdraw {refNo}?</DialogTitle>
            <DialogDescription>
              {item}. The client will no longer see it or be asked to decide. This cannot be undone — raise a new
              approval if it is needed again.
            </DialogDescription>
          </DialogHeader>
          {withdraw.result.serverError && (
            <p className="text-[12.5px] text-destructive">{withdraw.result.serverError}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="default" disabled={withdraw.isPending} />}>
              Keep it
            </DialogClose>
            <Button
              variant="destructive"
              disabled={withdraw.isPending}
              onClick={() => withdraw.execute({ approvalId })}
            >
              {withdraw.isPending ? "Withdrawing…" : "Withdraw"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
