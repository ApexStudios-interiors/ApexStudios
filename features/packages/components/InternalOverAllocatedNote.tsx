"use client";

import { isInternalOverAllocated } from "@/features/packages/service";

/**
 * APX-40: an amber, non-blocking note when the internal budget typed is more
 * than the allocated (client) budget — a negative margin is allowed (it is a
 * real, if unhappy, thing) but is almost always a typo or swapped fields.
 * Admin-only by construction: only the Add/Edit Package dialogs, which only an
 * admin can open, carry internal amounts at all.
 */
export function InternalOverAllocatedNote({
  allocated,
  internal,
  className = "",
}: {
  allocated: unknown;
  internal: unknown;
  className?: string;
}) {
  if (typeof allocated !== "string" || typeof internal !== "string") return null;
  if (!isInternalOverAllocated(allocated, internal)) return null;
  return (
    <p
      role="status"
      className={`rounded-lg bg-status-warning-bg px-3 py-2 text-[12.5px] text-status-warning ${className}`}
    >
      Internal budget is more than the allocated budget — this package would run at a loss. Check the two
      amounts are not swapped.
    </p>
  );
}
