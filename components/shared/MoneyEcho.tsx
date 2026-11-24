"use client";

import { formatINR } from "@/lib/money";
import { parseMoneyInput } from "@/lib/money/input";

/**
 * The live read-back under a money input (APX-40): "1,80,00,000" or
 * "18000000" both echo "₹1,80,00,000.00", so a misplaced zero is visible
 * before it is saved. Shows nothing until the text is a valid amount.
 */
export function MoneyEcho({ value, id }: { value: unknown; id?: string }) {
  const parsed = typeof value === "string" ? parseMoneyInput(value) : null;
  return (
    <p id={id} aria-live="polite" className="mt-1 min-h-4 text-xs text-muted-foreground tabular-nums">
      {parsed ? formatINR(parsed) : null}
    </p>
  );
}
