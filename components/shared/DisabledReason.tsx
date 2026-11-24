"use client";

import { useId, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Explains why a control is disabled, to everyone (APX-47).
 *
 * A disabled button fires no pointer events and cannot take focus, so a
 * `title` on it reached neither a keyboard user nor a phone. With a `reason`,
 * the control is wrapped in a focusable trigger (the same shape BillingAdmin's
 * "Create bill" and MinimumStockInfo use) that shows the reason in a Tooltip
 * on hover AND on focus, and names it for a screen reader via
 * aria-describedby. With no reason it renders the child untouched.
 */
export function DisabledReason({
  reason,
  children,
}: {
  reason: string | null | undefined;
  children: ReactNode;
}) {
  const id = useId();
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        tabIndex={0}
        aria-describedby={id}
        className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {children}
        <span id={id} className="sr-only">
          {reason}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-left font-normal normal-case tracking-normal">
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
