"use client";

import type { ReactNode } from "react";
import { useApp, type DialogState } from "@/context/AppContext";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * The one piece of every converted page that still needs `AppContext`: the
 * dialog host itself is mounted in the (app) layout and driven by
 * `openDialog`, which isn't going away this build (§4.5 converts the dialogs'
 * FORMS to Server Actions, not the open/close mechanism). Wrapping just the
 * trigger button in its own client leaf is what lets the page around it stay
 * a Server Component — build/04-projects-packages-phases.md §4.4's component
 * contract only asks that a presentational component's JSX not change, and
 * this button's markup is exactly what it replaces, just with the click
 * handler's context moved to the smallest possible boundary.
 */
export function OpenDialogButton({
  dialog,
  children,
  ...buttonProps
}: { dialog: DialogState; children: ReactNode } & Omit<ButtonProps, "onClick">) {
  const { openDialog } = useApp();
  return (
    <Button onClick={() => openDialog(dialog)} {...buttonProps}>
      {children}
    </Button>
  );
}
