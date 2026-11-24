"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
 * APX-17 / APX-39: the one confirmation every one-click billing action now
 * goes through — Submit bill, Cancel draft, Mark complete, Mark all complete.
 * Each states the ₹ amount it affects, shows a pending state, and cannot be
 * dismissed or pressed again while its request is in flight, so a double
 * click sends one request.
 */
export function ConfirmBillingActionDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  pendingLabel,
  destructive = false,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription render={<div />}>{children}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={pending} />}>Back</DialogClose>
          <Button variant={destructive ? "destructive" : "primary"} disabled={pending} onClick={onConfirm}>
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
