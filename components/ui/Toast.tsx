"use client";

import { CircleAlertIcon, XIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";

/**
 * The app-wide toast (APX-47).
 *
 * Both live regions are always in the DOM — a region inserted together with
 * its text is not reliably announced — and the message is written into the
 * one that matches its kind:
 *  - success → `role="status"` (`aria-live="polite"`), and it hides itself
 *    after TOAST_SUCCESS_MS;
 *  - error → `role="alert"` (assertive), and it stays until dismissed, so a
 *    failure cannot vanish before it has been read.
 */
export function Toast() {
  const { toastMsg, dismissToast } = useApp();
  const success = toastMsg?.kind === "success" ? toastMsg : null;
  const error = toastMsg?.kind === "error" ? toastMsg : null;

  const box =
    "fixed z-[60] bottom-5 right-5 max-sm:left-4 max-sm:right-4 max-sm:bottom-4 sm:max-w-sm rounded-lg bg-foreground text-background text-[13.5px] font-medium shadow-[0_8px_30px_-10px_rgba(0,0,0,0.4)] transition-all duration-200";

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true">
        {success && (
          <div key={success.id} className={`${box} pointer-events-none px-4 py-3`}>
            {success.msg}
          </div>
        )}
      </div>
      <div role="alert" aria-atomic="true">
        {error && (
          <div key={error.id} className={`${box} flex items-start gap-2.5 py-3 pl-4 pr-2`}>
            <CircleAlertIcon className="size-4 mt-0.5 flex-none" aria-hidden="true" />
            <span className="min-w-0 flex-1">{error.msg}</span>
            <button
              type="button"
              onClick={dismissToast}
              className="-my-1 grid size-7 flex-none place-items-center rounded-md hover:bg-background/15 focus-visible:outline-2 focus-visible:outline-background"
            >
              <XIcon className="size-4" aria-hidden="true" />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
