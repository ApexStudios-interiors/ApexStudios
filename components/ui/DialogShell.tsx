"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Spinner } from "./spinner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

/**
 * The form-dialog shell every DialogHost dialog renders into.
 *
 * Rebuilt on the shadcn / Base UI `Dialog` (the same one DeactivateUserButton
 * uses) so that it is a real modal: `role="dialog"`, `aria-modal`, labelled by
 * its title and described by its description, focus trapped inside while
 * open and returned to whatever had it before (APX-47). The props API is
 * unchanged, so every caller keeps working: a caller still mounts it to open
 * and unmounts it (from `onClose`) to close.
 *
 * Closing is guarded twice over:
 *  - while `okPending` the submit is in flight, so Escape, the backdrop, the
 *    close button and Cancel are all ignored — closing mid-submit used to
 *    throw away the result of the request the user was waiting on;
 *  - when `dirty`, a close attempt asks "Discard changes?" first, instead of
 *    silently dropping typed text and attached photos.
 *
 * Nested popups (Select, Popover, the date picker's Calendar) are Base UI
 * floating elements in the same tree, so Escape closes the innermost one
 * first and only reaches the dialog when nothing is open on top of it.
 *
 * On a phone (below `sm`) the dialog is a full-height sheet with a sticky
 * header and footer and a scrolling body; from `sm` up it is the centred
 * 640px card it always was.
 */
export function DialogShell({
  title,
  description,
  children,
  okLabel,
  onOk,
  okDisabled,
  okPending,
  onClose,
  dirty,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  okLabel: string;
  onOk: () => void;
  /** Cannot submit yet (nothing chosen, still loading). */
  okDisabled?: boolean;
  /** The submit is in flight: the OK button shows a spinner and is disabled,
   *  so a slow network is visible and cannot double-submit. Pass the caller's
   *  existing pending flag (`action.isPending`, a `pending` state). While it is
   *  true the dialog cannot be dismissed. */
  okPending?: boolean;
  onClose: () => void;
  /** The user has typed or attached something. Closing then asks
   *  "Discard changes?" before throwing it away. */
  dirty?: boolean;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Focus return. Base UI returns focus on a normal close, but every caller
  // UNMOUNTS this component to close it, which can skip the close transition
  // that does the returning. Remember what had focus when the dialog opened
  // and put it back on unmount, if it is still in the document.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const active = document.activeElement;
    returnFocusTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      const el = returnFocusTo.current;
      if (el && el.isConnected) {
        // After the dialog's own cleanup has run.
        setTimeout(() => {
          if (el.isConnected) el.focus();
        }, 0);
      }
    };
  }, []);

  const requestClose = () => {
    if (okPending) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        showCloseButton={!okPending}
        className={
          // Phone: full-height sheet. sm and up: the centred 640px card.
          "flex flex-col gap-0 p-0 overflow-hidden " +
          "max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none max-sm:ring-0 " +
          "sm:max-w-[640px] sm:max-h-[92vh] bg-background"
        }
      >
        <DialogHeader className="shrink-0 gap-1 px-6 max-sm:px-4 pt-[22px] pb-1 pr-12">
          <DialogTitle className="font-sans text-[17px] font-bold leading-tight tracking-tight">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-[13.5px] text-muted-foreground">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-6 max-sm:px-4 py-4">
          {children}
        </div>
        <div className="shrink-0 px-6 max-sm:px-4 pb-[22px] max-sm:pb-[max(16px,env(safe-area-inset-bottom))] pt-1 flex justify-end gap-2 max-sm:border-t max-sm:border-border max-sm:pt-3">
          <Button variant="default" onClick={requestClose} disabled={okPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onOk} disabled={okDisabled || okPending}>
            {okPending && <Spinner data-icon="inline-start" />}
            {okLabel}
          </Button>
        </div>

        {/* Nested Base UI dialog: Escape here closes only this confirm. */}
        <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <DialogContent showCloseButton={false} className="bg-background">
            <DialogHeader>
              <DialogTitle className="font-sans text-[15px] font-bold">Discard changes?</DialogTitle>
              <DialogDescription>What you have entered in “{title}” will be lost.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="default" />}>Keep editing</DialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
              >
                Discard
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  error,
  children,
}: {
  label: string;
  hint?: string;
  /**
   * Optional. Associates the label with its input via `htmlFor`/`id`, so
   * `getByLabel()` (Playwright, Testing Library) and screen readers can find
   * the field programmatically rather than by adjacency. Backward compatible —
   * every existing caller omits it and renders exactly as before. Added for
   * build/03-auth-and-rbac.md's login forms, which need it to be testable.
   */
  htmlFor?: string;
  /** A validation message for this field, shown under it. With `htmlFor`
   *  it gets the id `${htmlFor}-error` for the input's aria-describedby. */
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[12.5px] font-semibold mb-1.5">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-muted-foreground mt-1.5">{hint}</div>}
      {error && (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="text-xs text-destructive mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "w-full h-9 border border-input bg-background rounded-lg px-2.5 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const textareaClass =
  "w-full min-h-[72px] border border-input bg-background rounded-lg px-2.5 py-2 text-[13.5px] outline-none resize-y focus-visible:ring-2 focus-visible:ring-ring";
