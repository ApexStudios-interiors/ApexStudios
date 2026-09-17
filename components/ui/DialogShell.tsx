"use client";

import { type ReactNode, useEffect } from "react";
import { Button } from "./button";

export function DialogShell({
  title,
  description,
  children,
  okLabel,
  onOk,
  okDisabled,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  okLabel: string;
  onOk: () => void;
  okDisabled?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-xl w-full max-w-[640px] max-h-[92vh] overflow-auto shadow-[0_20px_50px_-20px_rgba(0,0,0,0.45)]">
        <div className="px-6 pt-[22px] pb-1">
          <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-[13.5px] text-muted-foreground">{description}</p>}
        </div>
        <div className="px-6 py-4">{children}</div>
        <div className="px-6 pb-[22px] pt-1 flex justify-end gap-2">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onOk} disabled={okDisabled}>
            {okLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
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
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[12.5px] font-semibold mb-1.5">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-muted-foreground mt-1.5">{hint}</div>}
    </div>
  );
}

export const inputClass =
  "w-full h-9 border border-input bg-background rounded-lg px-2.5 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const textareaClass =
  "w-full min-h-[72px] border border-input bg-background rounded-lg px-2.5 py-2 text-[13.5px] outline-none resize-y focus-visible:ring-2 focus-visible:ring-ring";
